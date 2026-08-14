import json
import os

log_path = r"C:\Users\Admin\.gemini\antigravity\brain\8120c6f1-e1cc-43d6-983b-2a8ef9359225\.system_generated\logs\transcript.jsonl"

with open(log_path, 'r', encoding='utf-8') as f:
    for line in f:
        try:
            data = json.loads(line)
            content = str(data.get("content", ""))
            tool_calls = str(data.get("tool_calls", ""))
            
            # search for mentions of 500 or request_r2v or request_scene
            if "500" in content or "500" in tool_calls or "r2v" in content or "i2v" in content:
                # print summary
                print(f"Step {data.get('step_index')}: Source: {data.get('source')} Type: {data.get('type')}")
                if len(content) > 200:
                    print("Content:", content[:200] + "...")
                else:
                    print("Content:", content)
                print("Tool Calls:", tool_calls[:200])
                print("-" * 50)
        except Exception as e:
            pass
