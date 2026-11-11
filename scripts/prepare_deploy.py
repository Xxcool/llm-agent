#!/usr/bin/env python3
"""仅从明确白名单生成部署包，保留目标已有运行数据，不同步个人知识。"""
import argparse
import json
import shutil
import tarfile
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent


def copy_tree(source: Path, target: Path) -> None:
    for path in source.rglob("*"):
        if not path.is_file() or path.is_symlink() or "__pycache__" in path.parts:
            continue
        if path.name.startswith(".") or path.suffix == ".pyc":
            continue
        dest = target / path.relative_to(source)
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(path, dest)


def prepare(dest: Path, target: str) -> None:
    if not (ROOT / "frontend/dist/index.html").is_file():
        raise ValueError("请先运行前端生产构建")
    dest = dest.resolve()
    if dest == ROOT or dest in ROOT.parents or (ROOT in dest.parents and dest.parts[len(ROOT.parts)] != "output"):
        raise ValueError("部署目录须位于仓库之外，或仓库 output/ 下")
    manifest = dest / ".deployment-manifest.json"
    existing = {str(p.relative_to(dest)) for p in dest.rglob("*") if p.is_file()} if dest.exists() else set()
    owned = set(json.loads(manifest.read_text())) | {manifest.name} if manifest.exists() else set()
    if existing - owned or any(p.is_symlink() for p in dest.rglob("*")):
        raise ValueError("目标目录含非本脚本生成的文件；请使用新目录，已有数据不会被修改")
    dest.mkdir(parents=True, exist_ok=True)
    if target == "modelscope":
        copy_tree(ROOT / "backend/app", dest / "backend/app")
        copy_tree(ROOT / "frontend/dist", dest / "frontend/dist")
        shutil.copy2(ROOT / "backend/requirements.lock", dest / "backend/requirements.lock")
        shutil.copy2(ROOT / "Dockerfile.modelscope", dest / "Dockerfile")
        (dest / "README.md").write_text(
            "---\nsdk: docker\napp_port: 7860\n---\n\n# 企业知识智能体\n\n"
            "免登录浏览器工作区；各自配置 API Key。请在独立应用页面使用，避免第三方 Cookie 限制。\n"
            "免费 CPU 可能休眠；模型调用费用由各自的服务商计费。\n",
            encoding="utf-8",
        )
    else:
        copy_tree(ROOT / "backend/app", dest / "app")
        copy_tree(ROOT / "frontend/dist", dest / "static")
        shutil.copy2(ROOT / "backend/requirements.txt", dest / "requirements.txt")
    # 只同步公开示例；不遍历 uploads、personal、沉淀或任何运行数据目录。
    kb = dest / ("backend/knowledge" if target == "modelscope" else "knowledge")
    copy_tree(ROOT / "backend/knowledge/samples", kb / "samples")
    if target == "modelscope":
        (dest / ".dockerignore").write_text("**/data\n**/__pycache__\n**/.env*\n**/*.key\n.git\n", encoding="utf-8")
        shutil.copy2(ROOT / "backend/requirements.lock", dest / "requirements.lock")
        # 网页上传支持普通文件；将白名单内容压成一个包，避免手动逐层建立目录。
        with tarfile.open(dest / "application.tar.gz", "w:gz") as tar:
            for directory in (dest / "backend", dest / "frontend"):
                for path in sorted(directory.rglob("*")):
                    if path.is_file():
                        tar.add(path, arcname=str(path.relative_to(dest)), recursive=False)
        # 目标已通过完整所有权校验；这里只清理刚生成的打包中间文件。
        shutil.rmtree(dest / "backend")
        shutil.rmtree(dest / "frontend")
    manifest.write_text(json.dumps(sorted(str(p.relative_to(dest)) for p in dest.rglob("*") if p.is_file())))
    print(f"Prepared {target} package: {dest}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("destination", type=Path)
    parser.add_argument("--target", choices=("modelscope", "workbuddy"), default="modelscope")
    args = parser.parse_args()
    prepare(args.destination, args.target)


if __name__ == "__main__":
    main()
