# 没办到时，你怎么想？

仅保留 brush 干刷版。真实手部摄影、深蓝网点、陶土色干刷与暖白纸纹，全部由 Python 处理，无图像生成。

## 文件

- `research-poster-v3-brush.png`：2400 × 3200 高清 PNG。
- `research-poster-share-v3-brush.jpg`：1200 × 1600 手机分享图。
- `research-poster-v3-brush.pdf`：203.2 × 270.9 mm 打印文件。
- `preview-v3-brush.jpg`：预览。
- `make_poster.py`：唯一版本的制作脚本，直接运行，无版本参数。
- `source-20805380.jpg`、`fonts/`：采用的照片及字体。
- `checks-v3-brush.json`：二维码和文字边界验证记录。

二维码：https://ink.zipawa.top/r/7Z5iJVqKlOI

## 来源与复现

摄影：Vera Emilie / Pexels。
[原始摄影](https://www.pexels.com/photo/close-up-of-raised-hands-of-a-woman-against-a-white-background-20805380/) · [Pexels 使用许可](https://www.pexels.com/license/)，允许使用与修改，照片不代表人物或摄影师为研究背书。

Noto Serif SC 随附 SIL Open Font License；正文使用本机 Microsoft YaHei，英文为 Bahnschrift，未分发 Microsoft 字体。

依赖：Python、Pillow、NumPy、SciPy、qrcode、reportlab、opencv-python。脚本默认使用 Windows 字体路径；其他系统可修改 `sans_path` 与 `latin_path`。高清、分享与预览图均验证可解码到正确问卷地址。
