# Manifest formats

工具链通过磁盘产物和简洁的 JSON manifest 串联。这里仅记录当前约定，不引入未被程序使用的 Schema 校验层。manifest 中的相对路径均以 manifest 所在目录为基准。

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

## 单个建筑 Mesh

```json
{
  "schemaVersion": 1,
  "artifactType": "textured-mesh",
  "buildingId": "w1",
  "obj": "model.obj",
  "mtl": "model.mtl"
}
```

## 建筑三视图

```json
{
  "schemaVersion": 1,
  "artifactType": "multiview-images",
  "buildingId": "w1",
  "views": {
    "front": "front.png",
    "oblique": "oblique.png",
    "top": "top.png"
  }
}
```

## 屋顶分类结果

```json
{
  "schemaVersion": 1,
  "artifactType": "roof-classification",
  "buildingId": "w1",
  "roofType": "flat"
}
```

详细坐标、瓦片、缓存和统计信息属于可选的 `metadata.json`，不参与工具链间的数据传递。
