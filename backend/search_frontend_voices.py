import os
import re

root_dir = r"c:\Users\Admin\Desktop\Dự án Riêng\Agent flow\FlowVisualStudio\frontend"
pattern = re.compile(r"voice|voiceId|voice_id|speaker", re.IGNORECASE)

results = []
for dirpath, dirnames, filenames in os.walk(root_dir):
    if "node_modules" in dirpath or ".git" in dirpath or "__pycache__" in dirpath:
        continue
    for filename in filenames:
        if filename.endswith(('.ts', '.tsx', '.js', '.json')):
            filepath = os.path.join(dirpath, filename)
            try:
                with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
                    for i, line in enumerate(f, 1):
                        if pattern.search(line):
                            results.append(f"{filepath}:{i}: {line.strip()}")
            except Exception as e:
                pass

with open(r"c:\Users\Admin\Desktop\Dự án Riêng\Agent flow\FlowVisualStudio\backend\scratch_search_frontend_voices.txt", "w", encoding="utf-8") as out:
    out.write("\n".join(results))
print(f"Done, found {len(results)} matches.")
