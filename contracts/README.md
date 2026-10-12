# Manifest formats

工具链通过磁盘产物和精简的 JSON manifest 串联。相对路径均以所在 manifest 的目录为基准。

## Mesh 数据集

```json
{
  "schemaVersion": 1,
  "artifactType": "textured-mesh-dataset",
  "buildings": [
    { "buildingId": "w1", "manifest": "w1/manifest.json" }
  ]
}
```

单栋建筑的 `textured-mesh` manifest 包含 `buildingId`、`obj` 和 `mtl`。

## 多视图数据集

根 manifest 使用 `artifactType: "multiview-images-dataset"`，并通过 `buildings` 数组索引单栋 manifest，结构与 Mesh 数据集一致。

单栋建筑 manifest：

```json
{
  "schemaVersion": 1,
  "artifactType": "multiview-images",
  "buildingId": "w1",
  "views": [
    {
      "id": "view_001",
      "image": "view_001.png",
      "azimuthDeg": 0,
      "elevationDeg": 90,
      "width": 320,
      "height": 416
    }
  ]
}
```

`views` 是无语义的有序数组；下游应读取角度参数，而不是从文件名推断视图含义。

## 屋顶分类结果

```json
{
  "schemaVersion": 1,
  "artifactType": "roof-classification",
  "buildingId": "w1",
  "roofType": "flat"
}
```

坐标、瓦片缓存和统计细节属于可选的 `metadata.json`，不参与工具链间的数据传递。
