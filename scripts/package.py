import os
import json
import zipfile

root_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
dist_dir = os.path.join(root_dir, 'dist')

pkg_path = os.path.join(root_dir, 'package.json')
version = '1.1.5'
if os.path.exists(pkg_path):
    with open(pkg_path, 'r') as f:
        try:
            version = json.load(f).get('version', '1.0.0')
        except Exception:
            version = '1.1.5'

zip_name = f'browseragent-v{version}.zip'
zip_path = os.path.join(root_dir, zip_name)
latest_zip_path = os.path.join(root_dir, 'browseragent.zip')

if not os.path.exists(dist_dir):
    print("dist directory does not exist. Run build first.")
    exit(1)

for path in [zip_path, latest_zip_path]:
    if os.path.exists(path):
        os.remove(path)

for target_zip in [zip_path, latest_zip_path]:
    with zipfile.ZipFile(target_zip, 'w', zipfile.ZIP_DEFLATED) as zipf:
        for root, dirs, files in os.walk(dist_dir):
            for file in files:
                full_path = os.path.join(root, file)
                rel_path = os.path.relpath(full_path, dist_dir)
                zipf.write(full_path, rel_path)

print(f"Successfully created: {zip_path} ({os.path.getsize(zip_path)} bytes)")
print(f"Successfully created: {latest_zip_path} ({os.path.getsize(latest_zip_path)} bytes)")
