#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
train_contrastive_v11.py — 方案B：LLM 增强跨论文语义对比 + t-SNE 混合目标

目标（可消融）：
    L = lambda_tsne * KL(P||Q)              # 全局邻域保真（= v10 的目标）
      + lambda_con  * InfoNCE(正对, 行归一化 Student-t)   # 跨论文语义等价对拉近

关键点：
  * 参数化：仍是 ResidualProjectionMapper（可复用函数，能投新点），沿用 v10r 正则（dropout+输入抖动）。
  * 正样本来自 augment_pairs_llm.py 的 train_pos（跨论文语义等价，不是论文身份）→ 强化 boundary zone。
  * InfoNCE 复用与 t-SNE 相同的 Student-t 核（行归一化），几何一致、计算便宜（复用 num 矩阵）。
  * 三个实验臂：
      v10 复现：  --lambda-tsne 1 --lambda-con 0
      纯对比：    --lambda-tsne 0 --lambda-con 1
      混合(推荐)：--lambda-tsne 1 --lambda-con 0.3

用法：
  python3 code_for_model/train_contrastive_v11.py --pairs data/stages/02_msu/llm_pairs.json \
      --lambda-tsne 1 --lambda-con 0.3 --out data/stages/05_model/bert2d_mapper_all_v11_hybrid.pt
"""
from __future__ import annotations
import argparse, json, sys
from pathlib import Path
import numpy as np
import torch
import torch.optim as optim

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))
import local_config as cfg
from code_for_model.models import ResidualProjectionMapper, set_seed, load_embeddings, evaluate_quick, compute_joint_P


def load_pairs_as_rows(pairs_path, ids):
    """把 pairs.json 里的行索引对映射到当前 embedding 的行（若 ids 顺序一致则恒等）。"""
    d = json.load(open(pairs_path, encoding="utf-8"))
    N = len(ids)
    def _clip(p):
        out = [(int(a), int(b)) for a, b, *_ in p if 0 <= int(a) < N and 0 <= int(b) < N and int(a) != int(b)]
        return out
    return _clip(d.get("train_pos", [])), _clip(d.get("test_pos", [])), d.get("meta", {})


def bz_recall(z_np, x_np, pairs, k=12):
    """held-out 正对在 2D / 高维 的 top-k 近邻召回（越高=越好地把跨论文等价对放到一起）。"""
    from sklearn.neighbors import NearestNeighbors
    if not pairs:
        return {"n": 0}
    def recall(space):
        nn = NearestNeighbors(n_neighbors=k + 1).fit(space)
        _, ind = nn.kneighbors(space)
        neigh = [set(row[1:]) for row in ind]
        hit = sum(1 for a, b in pairs if b in neigh[a] or a in neigh[b])
        return hit / len(pairs)
    return {"n": len(pairs), f"bz_recall@{k}_2d": recall(z_np), f"bz_recall@{k}_highD": recall(x_np)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", type=Path, default=cfg.EMB_CACHE)
    ap.add_argument("--pairs", type=Path, default=cfg.MSU_DIR / "llm_pairs.json")
    ap.add_argument("--out", type=Path, default=cfg.MODEL_DIR / "bert2d_mapper_all_v11_hybrid.pt")
    ap.add_argument("--lambda-tsne", type=float, default=1.0)
    ap.add_argument("--lambda-con", type=float, default=0.3)
    ap.add_argument("--perplexity", type=float, default=30.0)
    ap.add_argument("--iters", type=int, default=1500)
    ap.add_argument("--exaggeration", type=float, default=12.0)
    ap.add_argument("--exaggeration-iters", type=int, default=250)
    ap.add_argument("--lr", type=float, default=1e-3)
    ap.add_argument("--width", type=int, default=512)
    ap.add_argument("--blocks", type=int, default=4)
    ap.add_argument("--dropout", type=float, default=0.1)
    ap.add_argument("--input-noise", type=float, default=0.4)
    ap.add_argument("--eval-k", type=int, default=12)
    ap.add_argument("--device", default="cuda" if torch.cuda.is_available() else "cpu")
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--cross-paper-weight", type=float, default=1.0, help="P 中跨论文近邻的权重；>1 时需要 --formdb")
    ap.add_argument("--formdb", type=Path, default=None, help="提供每条 MSU 的 paper_id，与嵌入按 idx 对齐")
    ap.add_argument("--p-cache", type=Path, default=None, help="P 矩阵缓存(存在则读，不存在则算完写入)")
    args = ap.parse_args()
    set_seed(args.seed)
    device = torch.device(args.device)
    eps = 1e-12

    x_np, ids = load_embeddings(args.cache)
    n = x_np.shape[0]
    train_pos, test_pos, meta = load_pairs_as_rows(args.pairs, ids)
    print(f"[v11] N={n} dim={x_np.shape[1]} | lambda_tsne={args.lambda_tsne} lambda_con={args.lambda_con}")
    print(f"[v11] positives: train={len(train_pos)} test(held-out)={len(test_pos)} | pairs meta={meta.get('note','')[:60]}")

    x = torch.tensor(x_np, dtype=torch.float32, device=device)
    eye = torch.eye(n, dtype=torch.bool, device=device)

    P = None
    if args.lambda_tsne > 0:
        P_np = None
        if args.p_cache and args.p_cache.exists():
            cached = np.load(args.p_cache)
            if cached.shape == (n, n):
                P_np = cached; print(f"[P] loaded cache {args.p_cache}")
            else:
                print(f"[P] 缓存维度 {cached.shape} != ({n}, {n})，忽略并重算")
        if P_np is None:
            P_np = compute_joint_P(x_np, args.perplexity)
            if args.p_cache:
                args.p_cache.parent.mkdir(parents=True, exist_ok=True)
                np.save(args.p_cache, P_np); print(f"[P] cached -> {args.p_cache}")
        if args.cross_paper_weight > 1:
            # 二维压缩主要丢失跨论文近邻，这里提高它们在邻域目标里的比重
            paper_of = {int(r["idx"]): int(r["paper_id"]) for r in json.load(open(args.formdb)) if r.get("idx") not in (None, "")}
            papers = np.array([paper_of[int(i)] for i in ids])
            P_np = P_np * np.where(papers[:, None] != papers[None, :], args.cross_paper_weight, 1.0)
            P_np = P_np / P_np.sum()
        P = torch.tensor(P_np, dtype=torch.float32, device=device)
        print(f"[P] ready {P_np.shape}")

    pa = torch.tensor([a for a, b in train_pos], dtype=torch.long, device=device)
    pb = torch.tensor([b for a, b in train_pos], dtype=torch.long, device=device)

    mapper = ResidualProjectionMapper(embed_dim=x_np.shape[1], width=args.width,
                                      num_blocks=args.blocks, dropout=args.dropout).to(device)
    opt = optim.Adam(mapper.parameters(), lr=args.lr)
    sched = optim.lr_scheduler.CosineAnnealingLR(opt, T_max=args.iters)
    noise_std = args.input_noise / (x_np.shape[1] ** 0.5) if args.input_noise > 0 else 0.0

    mapper.train()
    for it in range(args.iters):
        xin = x + noise_std * torch.randn_like(x) if noise_std > 0 else x
        Z = mapper(xin)
        D2 = torch.cdist(Z, Z) ** 2
        num = (1.0 / (1.0 + D2)).masked_fill(eye, 0.0)

        loss = torch.zeros((), device=device)
        if args.lambda_tsne > 0:
            Q = (num / num.sum().clamp_min(eps)).clamp_min(eps)
            Pe = P * args.exaggeration if it < args.exaggeration_iters else P
            Pn = (Pe / Pe.sum()).clamp_min(eps)
            loss = loss + args.lambda_tsne * (Pn * (Pn.log() - Q.log())).sum()
        if args.lambda_con > 0 and len(train_pos) > 0:
            Qrow = (num / num.sum(dim=1, keepdim=True).clamp_min(eps)).clamp_min(eps)  # 行归一化 Student-t
            # InfoNCE：正对应成为彼此的高概率近邻（全体点作负样本，对称两向）
            l_ab = -Qrow[pa, pb].log().mean()
            l_ba = -Qrow[pb, pa].log().mean()
            loss = loss + args.lambda_con * 0.5 * (l_ab + l_ba)

        opt.zero_grad(); loss.backward()
        torch.nn.utils.clip_grad_norm_(mapper.parameters(), 5.0)
        opt.step(); sched.step()

        if it == 0 or (it + 1) % 100 == 0:
            mapper.eval()
            with torch.no_grad():
                z_np = mapper(x).cpu().numpy()
            tw, ko = evaluate_quick(x_np, z_np, args.eval_k)
            rec = bz_recall(z_np, x_np, test_pos, args.eval_k)
            print(f"[v11] it {it+1:04d}/{args.iters} loss={loss.item():.4f} "
                  f"trust={tw:.3f} knnOv={ko:.3f} "
                  f"BZrec@{args.eval_k}_2d={rec.get(f'bz_recall@{args.eval_k}_2d', float('nan')):.3f}")
            mapper.train()

    mapper.eval()
    with torch.no_grad():
        z_final = mapper(x).cpu().numpy()
    tw, ko = evaluate_quick(x_np, z_final, args.eval_k)
    rec = bz_recall(z_final, x_np, test_pos, args.eval_k)
    print(f"\n[v11] FINAL trust={tw:.3f} knnOv={ko:.3f} {rec}")

    args.out.parent.mkdir(parents=True, exist_ok=True)
    torch.save({
        "model_class": "ResidualProjectionMapper",
        "mapper_state": mapper.state_dict(),
        "embed_dim": x_np.shape[1], "width": args.width, "num_blocks": args.blocks,
        "dropout": args.dropout, "out_dim": 2,
        "objective": f"hybrid parametric t-SNE + cross-paper InfoNCE "
                     f"(lambda_tsne={args.lambda_tsne}, lambda_con={args.lambda_con}, "
                     f"cross_paper_weight={args.cross_paper_weight}, perplexity={args.perplexity}, "
                     f"dropout={args.dropout}, input_noise={args.input_noise})",
        "final_metrics": {"trust": tw, "knnOv": ko, **rec},
    }, args.out)
    print(f"[save] {args.out}")


if __name__ == "__main__":
    main()
