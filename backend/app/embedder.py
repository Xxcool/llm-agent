"""Embedding 层：fastembed 本地模型优先，失败自动降级 hash 向量（保证零依赖可跑）。"""
import hashlib
import math
import re
from typing import List

from . import config


class BaseEmbedder:
    dim = 0

    def embed(self, texts: List[str]) -> List[List[float]]:
        raise NotImplementedError


class FastembedEmbedder(BaseEmbedder):
    """本地 ONNX 模型（BAAI/bge-small-zh-v1.5），无 API Key。"""

    def __init__(self, model: str):
        from fastembed import TextEmbedding  # 延迟导入，首次运行会下载模型
        self._model = TextEmbedding(model_name=model)
        self.dim = len(next(iter(self._model.embed(["dim"]))))

    def embed(self, texts: List[str]) -> List[List[float]]:
        return [v.tolist() for v in self._model.embed(texts)]


class HashEmbedder(BaseEmbedder):
    """降级方案：字符 2-gram 哈希向量（确定性、离线、效果弱于语义模型）。"""

    DIM = 512

    def __init__(self):
        self.dim = self.DIM

    def _vec(self, text: str) -> List[float]:
        v = [0.0] * self.DIM
        grams = re.findall(r"..", text) or [text]
        for g in grams:
            h = int(hashlib.md5(g.encode()).hexdigest(), 16) % self.DIM
            v[h] += 1.0
        norm = math.sqrt(sum(x * x for x in v)) or 1.0
        return [x / norm for x in v]

    def embed(self, texts: List[str]) -> List[List[float]]:
        return [self._vec(t) for t in texts]


def get_embedder() -> BaseEmbedder:
    if config.EMBED_BACKEND == "hash":
        return HashEmbedder()
    try:
        return FastembedEmbedder(config.EMBED_MODEL)
    except Exception as e:  # noqa: BLE001 模型下载失败/网络受限时降级
        if config.EMBED_BACKEND == "auto":
            print(f"[embedder] fastembed 不可用（{e.__class__.__name__}），降级 HashEmbedder")
            return HashEmbedder()
        raise
