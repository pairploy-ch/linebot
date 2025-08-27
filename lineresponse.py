import asyncio
import json
import os
import aiohttp
from datetime import datetime
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Get API key from environment variables
OPENAI_API_KEY = os.getenv('OPENAI_API_KEY')
if not OPENAI_API_KEY:
    print("Error: OPENAI_API_KEY not found in environment variables.")
    exit()

# You will need to mock these functions from your webhook-server.js
async def classify_message_with_ai(prompt):
    """Mocks the classifyMessageWithAI function from the JS backend."""
    url = "https://api.openai.com/v1/chat/completions"
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {OPENAI_API_KEY}"
    }
    
    classification_prompt = f"""
You are an intent classifier for a personal assistant. Your job is to determine the user's intent from the message and respond with a single, specific category code. Do not include any other text, explanation, or punctuation.
Categories:
- create_task: User write a certain thing which seems to be a task or thing user is to do
- summarize_task: User wants to know, summarize or list tasks within a specific date range (maybe no obvious word)
- general_search: User is asking a general knowledge question or for a summary.
- create_content: User wants to draft an email, social media post, script, or other text.
- unknown: The intent does not match any of the above categories.
User message: "{prompt}"
Your response (single category code only):
    """

    data = {
        "model": "gpt-4o-mini",
        "messages": [{"role": "user", "content": classification_prompt}],
        "max_tokens": 10,
        "temperature": 0
    }

    async with aiohttp.ClientSession() as session:
        try:
            async with session.post(url, headers=headers, json=data) as response:
                response.raise_for_status()
                result = await response.json()
                category = result['choices'][0]['message']['content'].strip()
                return category
        except aiohttp.ClientResponseError as e:
            print(f"HTTP Error: {e.status} - {e.message}")
            return "unknown"
        except Exception as e:
            print(f"An error occurred: {e}")
            return "unknown"


async def create_task_with_ai(prompt):
    """Mocks the createTaskWithAI function."""
    url = "https://api.openai.com/v1/chat/completions"
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {OPENAI_API_KEY}"
    }

    current_date = datetime.now().strftime("%A %d/%m/%Y %H.%M")

    analyze_create_task_prompt = f"""
รับคำสั่งสร้าง reminder แปลงเป็น JSON

{{
  "intent": "add_reminder",
  "task": "<สิ่งที่ต้องทำ>", (ไม่เกิน 8 คำ)
  "time": "<HH:MM>",
  "date": "<YYYY-MM-DD>",
  "repeat": "<once | daily | weekly | monthly | yearly>"
}}

กติกา:
- today date is {current_date}
- “พรุ่งนี้”, “วันนี้” → แปลงเป็นวันที่จริง 
- “ทุกวัน/พุธ” → set repeat ให้ตรง
- ไม่มีคำซ้ำ → repeat = once
ตอบกลับเป็น JSON เท่านั้น ห้ามมีคำอธิบาย

ถ้าไม่มี task ให้เขียนส่งเป็นไฟล์ json
{{
"error" : "title" 
}}

กรณีไม่บอกวันที่และเวลา: ถ้าตอนนี้ยังไม่เกิน 12.00 เที่ยงวัน ให้ตั้งเป็นวันนี้ 18.00 ถ้าเลยเที่ยงวันแล้ว ให้ตั้งเป็นพรุ่งนี้ 8.00 
ถ้าบอกเวลา แต่ไม่บอกวันที่ : ถ้าเลยเวลาปัจจุบัน ให้ตั้งเป็นวันถัดไป แต่ถ้ายังไม่เลยเวลาปัจจุบัน ให้ตั้งเป็นวันนี้
ถ้าบอกวันที่ แต่ไม่บอกเวลา : time = 8.00 (ยกเว้นถ้าวันนี้เลย 8.00 แล้ว ให้ตั้งเป็น 18.00, ถ้าเลย 18.00 ให้ตั้งเป็น 8.00 ของวันถัดไป)


User message: "{prompt}"
    """

    data = {
        "model": "gpt-4o-mini",
        "messages": [{"role": "user", "content": analyze_create_task_prompt}],
        "max_tokens": 200,
        "temperature": 0
    }

    async with aiohttp.ClientSession() as session:
        try:
            async with session.post(url, headers=headers, json=data) as response:
                response.raise_for_status()
                result = await response.json()
                return result['choices'][0]['message']['content'].strip()
        except aiohttp.ClientResponseError as e:
            print(f"HTTP Error: {e.status} - {e.message}")
            return json.dumps({"error": "api"})
        except Exception as e:
            print(f"An error occurred: {e}")
            return json.dumps({"error": "api"})

async def summarize_date_range_with_ai(prompt):
    """Mocks the summarizeDateRangeWithAI function."""
    url = "https://api.openai.com/v1/chat/completions"
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {OPENAI_API_KEY}"
    }
    
    current_date = datetime.now().strftime("%A %d/%m/%Y %H.%M")

    analyze_range_prompt = f"""
รับคำสั่งสรุป "ช่วงวันที่" แล้วตอบเป็น JSON เท่านั้น (ห้ามมีคำอธิบายอื่น)

สกีมา:
{{
  "start_date": "YYYY, M, D, 00, 00, 00, 00000",
  "end_date":   "YYYY, M, D, 23, 59, 59, 99999",
  "range_type": <1 | 2>
}}

เงื่อนไขและกติกา:
- today date is {current_date} (โซนเวลา Asia/Bangkok)
- ถ้าระบุวันเดียว (single day) ให้:
  - range_type = 1
- ถ้าเป็นช่วงหลายวัน (multiple days) ให้:
  - range_type = 2
- ถ้าให้ชื่อเดือน/สัปดาห์โดยไม่ระบุวัน ให้ตีความเป็นช่วงทั้งหมดของหน่วยนั้น:
  - เดือน: จากวันแรกของเดือนนี้ถึงวันสุดท้ายของเดือนนี้
  - สัปดาห์: ให้เริ่มจากวันนี้ และไปสิ้นสุดภายใน 7 วัน (รวมวันเริ่มต้น)
- ถ้าไม่พบวันที่จากข้อความ ให้ตอบ:
  {{
    "error": "date"
  }}
- ห้ามมีฟิลด์อื่นนอกเหนือจากที่กำหนด

ผู้ใช้: "{prompt}"
    """
    
    data = {
        "model": "gpt-4o-mini",
        "messages": [{"role": "user", "content": analyze_range_prompt}],
        "max_tokens": 200,
        "temperature": 0
    }

    async with aiohttp.ClientSession() as session:
        try:
            async with session.post(url, headers=headers, json=data) as response:
                response.raise_for_status()
                result = await response.json()
                return result['choices'][0]['message']['content'].strip()
        except aiohttp.ClientResponseError as e:
            print(f"HTTP Error: {e.status} - {e.message}")
            return json.dumps({"error": "api"})
        except Exception as e:
            print(f"An error occurred: {e}")
            return json.dumps({"error": "api"})


async def main():
    print("Welcome to the local webhook test script.")
    print("Type your message and press Enter. Type 'exit' to quit.")
    
    while True:
        user_input = input("You: ")
        if user_input.lower() == 'exit':
            break
        
        # Check for 'alin' or 'อลิน' prefix and get the rest of the message
        if user_input.lower().startswith("alin ") or user_input.startswith("อลิน "):
            ai_prompt = user_input.split(" ", 1)[1]
            
            print("Processing...")
            
            intent = await classify_message_with_ai(ai_prompt)
            print(f"Intent detected: {intent}")
            
            if intent == "create_task":
                ai_output = await create_task_with_ai(ai_prompt)
                print("AI Output (create_task):")
                print(ai_output)
            elif intent == "summarize_task":
                ai_output = await summarize_date_range_with_ai(ai_prompt)
                print("AI Output (summarize_task):")
                print(ai_output)
            elif intent == "general_search":
                # General search is not mocked here as it relies on a separate model call
                print("General search intent detected. (Not implemented in this test script)")
            elif intent == "create_content":
                # Content creation is not mocked here
                print("Content creation intent detected. (Not implemented in this test script)")
            else:
                print("Unknown intent.")
                
        else:
            print("Please start your message with 'alin ' or 'อลิน '")

if __name__ == "__main__":
    asyncio.run(main())
