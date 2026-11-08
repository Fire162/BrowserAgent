import os
import zipfile

root_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
dist_dir = os.path.join(root_dir, 'dist')
zip_path = os.path.join(root_dir, 'browseragent-v1.0.0.zip')

if not os.path.exists(dist_dir):
    print("dist directory does not exist. Run build first.")
    exit(1)

if os.path.exists(zip_path):
    os.remove(zip_path)

with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
    for root, dirs, files in os.walk(dist_dir):
        for file in files:
            full_path = os.path.join(root, file)
            rel_path = os.path.relpath(full_path, dist_dir)
            zipf.write(full_path, rel_path)

print(f"Successfully created: {zip_path} ({os.path.getsize(zip_path)} bytes)")
