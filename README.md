# City4RPV toolchains

本项目当前按三个可独立运行、可通过产物串联的工具链组织：

```text
OSM GeoJSON + 3D Tiles
        ↓
tiles-to-mesh
        ↓ textured OBJ manifest
mesh-to-images
        ↓ front / oblique / top PNG manifest
images-to-vlm
        ↓ roofType string result
```

目前 `tiles-to-mesh` 已实现；另外两个工具链只有输入输出契约、任务发现接口、固定配置入口和测试框架，尚未实现 Blender 渲染或 vLLM 请求。

## 目录

```text
toolchains/
  tiles-to-mesh/
    node/                 # 主流程、裁剪与合并
    python/               # glTF → OBJ 批转换
  mesh-to-images/         # Blender 多视图渲染框架
  images-to-vlm/          # vLLM 分类框架
contracts/                # 工具链之间的 manifest 格式说明
workflows/
  roof-classification/    # 三阶段薄编排层
artifacts/
  tile-cache/             # 持久化瓦片 OBJ 缓存
  meshes/                 # 每个 full_id 的纹理 Mesh
  images/                 # 预留：每个 full_id 的三个 PNG
  predictions/            # 预留：每个 full_id 的分类结果
tests/                    # 跨工具链测试数据
GeoWind3D-public/         # 只读参考代码
```

每条工具链拥有自己的配置与入口，不直接引用其他工具链的内部代码。串联通过磁盘产物和 `manifest.json` 完成，`contracts/README.md` 记录当前格式约定。

## tiles-to-mesh

编辑 `toolchains/tiles-to-mesh/node/src/config.ts`，然后运行：

```powershell
npm ci
npm run tiles-to-mesh:python:sync
npm run tiles-to-mesh:run
```

兼容入口仍然可用：

```powershell
npm run extract
```

输入 GeoJSON 必须是 EPSG:4326 Polygon/MultiPolygon FeatureCollection，每个要素具有唯一且可用作目录名的 `properties.full_id`。当前配置将每个建筑范围扩大 2 米，并输出到：

```text
artifacts/meshes/Munich_building2/<full_id>/
  model.obj
  model.mtl
  textures/
  metadata.json
  manifest.json
```

OBJ 使用以单个建筑缓冲范围中心为原点的局部 ENU 米制坐标：X 向东、Y 向北、Z 向上。

## 后续工具链的固定接口

`mesh-to-images` 对每个 `full_id` 计划输出：

```text
artifacts/images/<dataset>/<full_id>/
  front.png
  oblique.png
  top.png
  manifest.json
```

`images-to-vlm` 读取上述三个视图，并计划输出：

```text
artifacts/predictions/<dataset>/<full_id>/result.json
```

当前 `result.json` 的核心字段为非空字符串 `roofType`。各阶段的 manifest 格式见 `contracts/README.md`。

## 测试

```powershell
npm test
```

Munich 实际数据集成测试：

```powershell
$env:MUNICH_TILES_DIR = "E:\data\Google3DTile\Cities\Munich"
npm run tiles-to-mesh:test:integration
```

完整工作流入口已经预留：

```powershell
npm run roof-classification:run
```

在 Blender 和 vLLM 阶段实现前，该入口会在对应占位阶段明确停止，不会生成伪造结果。
