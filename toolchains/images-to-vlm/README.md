# images-to-vlm

当前只实现输入边界和任务发现，尚未实现 vLLM 请求与屋顶分类。

工具链读取 `multiview-images-dataset` 根 manifest，再读取每栋建筑 manifest 中的通用 `views` 数组。它不依赖 `top`、`front` 等固定字段；每个视图提供图片路径、方位角、高度角和图像尺寸。

未来输出为：

```text
artifacts/predictions/<dataset>/<full_id>/result.json
```

其中 `roofType` 是非空字符串。
