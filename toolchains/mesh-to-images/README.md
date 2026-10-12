# mesh-to-images

读取 `tiles-to-mesh` 生成的纹理 Mesh 数据集，在一个 Blender 后台进程中批量生成三张正交投影视图。

## 运行

直接编辑 [config.py](config.py) 后运行：

```powershell
python toolchains/mesh-to-images/main.py
```

不接收用户命令行参数。默认 Blender 路径为 `D:\Applications\Blender\blender.exe`。

默认视图为 `view_001`（方位角 0°、高度角 90°）、`view_002`（0°、45°）和 `view_003`（90°、45°）。ENU 中方位角从北侧开始顺时针增加；正俯视图为 East 向右、North 向上。

渲染采用实际 Mesh 顶点、正交相机和 10% 留白。默认密度为 10 px/m，最长边不超过 512 px，最短画布边至少 128 px，宽高补齐到 16 的倍数。补齐仅增加留白，不会把模型放大到超过 10 px/m。

输出：

```text
artifacts/images/<dataset>/
  manifest.json
  <full_id>/
    view_001.png
    view_002.png
    view_003.png
    manifest.json
```

全部建筑先写入 staging；只有整批成功后才替换正式目录。首版不使用渲染缓存。

运行时每当一栋建筑的三张视图和单体 manifest 全部完成，会输出一次 `Rendered <完成数>/<总数>: <full_id>`；Blender 的其他内部日志仅保留用于失败诊断。

## 测试

```powershell
npm run mesh-to-images:test
npm run mesh-to-images:test:integration
```

集成测试使用实际 Mesh 数据集的第一栋建筑并调用 Blender。
