import httpx
from openai import OpenAI
import base64
import time

client = OpenAI(
    base_url="http://127.0.0.1:8000/v1",
    api_key="dummy",
    http_client=httpx.Client(
        trust_env=False
    ),
)

model = client.models.list().data[0].id

image_paths = [
    r"./roof/20.png",  # 斜视图
    r"./roof/21.png",  # 俯视图
]

# 构造多图输入
content = [
    {
        "type": "text",
        "text": """
请综合观察同一栋建筑的两张图片（斜视图和俯视图），
判断其主要屋顶形态。

可选类型：
平屋顶、坡屋顶、弧形屋顶、穹顶、金字塔顶、其他特殊屋顶。

只输出选择的类型，不要输出任何解释或额外文本。
"""
    }
]

for image_path in image_paths:
    with open(image_path, "rb") as f:
        image_b64 = base64.b64encode(f.read()).decode("utf-8")

    content.append({
        "type": "image_url",
        "image_url": {
            "url": f"data:image/png;base64,{image_b64}"
        }
    })

# 推理
start_time = time.perf_counter()

response = client.chat.completions.create(
    model=model,
    messages=[
        {
            "role": "user",
            "content": content
        }
    ],
    temperature=0,
    max_tokens=256,
)

elapsed_time = time.perf_counter() - start_time

# image_path = r"./roof/10.png"

# prompt = """
# 这是一座建筑物的斜视图，请仔细观察该建筑的屋顶形态。

# 判断其属于以下哪种类型：
# 平屋顶、坡屋顶、弧形屋顶、穹顶、金字塔顶、其他特殊屋顶。

# 请详细说明你的判断依据，为什么将其归为该类型。
# """

# with open(image_path, "rb") as f:
#     image_b64 = base64.b64encode(f.read()).decode("utf-8")

# start_time = time.perf_counter()

# response = client.chat.completions.create(
#     model=model,
#     messages=[
#         {
#             "role": "user",
#             "content": [
#                 {
#                     "type": "text",
#                     "text": prompt
#                 },
#                 {
#                     "type": "image_url",
#                     "image_url": {
#                         "url": f"data:image/png;base64,{image_b64}"
#                     }
#                 }
#             ]
#         }
#     ],
#     temperature=0,
#     max_tokens=256,
# )

elapsed_time = time.perf_counter() - start_time

print(response.choices[0].message.content.strip())
print(f"Response time: {elapsed_time:.3f} seconds")