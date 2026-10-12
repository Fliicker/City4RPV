# images-to-vlm

读取 `multiview-images-dataset`，通过 vLLM OpenAI 兼容服务为每栋建筑的三张视图生成规范化屋顶类型。

## 运行

直接编辑 [config.py](config.py) 后运行：

```powershell
python toolchains/images-to-vlm/main.py
```

默认连接 `http://127.0.0.1:8000/v1`，模型为 `/root/models/Qwen3-VL-2B-Instruct-GPTQ-Int4`。每栋建筑对应一个三图请求，默认并发数为 8。

输出结构：

```text
artifacts/predictions/<dataset>/
  manifest.json
  <full_id>/
    result.json
```

模型输出由 vLLM 约束为六个中文类别，再确定性转换为 `flat`、`pitched`、`curved`、`dome`、`pyramidal` 或 `other`。

`overwrite=False` 时会复用已有且格式有效的单栋结果；当前不使用图片或配置指纹，因此图片、模型或推理配置变化后应设置 `overwrite=True`。

临时连接错误、超时、HTTP 429 和 5xx 会自动重试。部分建筑失败时，已完成的单栋结果会保留，进程以非零状态结束；再次运行可补齐。

## 测试

```powershell
npm run images-to-vlm:test
npm run images-to-vlm:test:integration
```

集成测试会向配置的真实 vLLM 服务发送一栋建筑的三张图片。
