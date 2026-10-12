# City4RPV toolchains

项目由三个可独立运行、通过磁盘产物和 manifest 串联的工具链组成：

```text
OSM GeoJSON + 3D Tiles
  -> tiles-to-mesh
  -> textured Mesh dataset
  -> mesh-to-images
  -> multiview image dataset
  -> images-to-vlm
  -> roofType result
```

每条工具链拥有自己的固定配置和入口，不直接引用其他工具链的内部实现。数据接口见 [contracts/README.md](contracts/README.md)。

## 目录

```text
toolchains/
  tiles-to-mesh/       # 3D Tiles 转逐建筑纹理 OBJ
    node/
    python/
  mesh-to-images/      # Blender 多视图批量渲染
  images-to-vlm/       # vLLM 多视图屋顶分类
contracts/             # manifest 格式说明
workflows/
  roof-classification/ # 三阶段顺序编排
artifacts/
  tile-cache/
  meshes/
  images/
  predictions/
```

## 运行

所有运行参数都直接写在各工具链的配置文件中，不需要附加 CLI 参数。

```powershell
npm ci
npm run tiles-to-mesh:python:sync
npm run tiles-to-mesh:run
npm run mesh-to-images:run
npm run images-to-vlm:run
```

`tiles-to-mesh` 的 OBJ 使用局部 ENU 米制坐标：X 向东、Y 向北、Z 向上。`mesh-to-images` 为每个 `full_id` 输出 `view_001.png`、`view_002.png`、`view_003.png` 以及单体 manifest，并在数据集根目录输出索引 manifest。

完整工作流入口：

```powershell
npm run roof-classification:run
```

三个阶段均已实现。最后阶段为每栋建筑输出一个规范化 `roofType`，并生成分类数据集根 manifest。

## 测试

```powershell
npm test
npm run mesh-to-images:test:integration
npm run images-to-vlm:test:integration
```
