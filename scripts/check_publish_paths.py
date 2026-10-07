"""Check selected Git paths before publishing; this is not a secret scanner."""
import argparse
from pathlib import Path, PurePosixPath
import subprocess

parser = argparse.ArgumentParser(description=__doc__)
group = parser.add_mutually_exclusive_group(required=True)
group.add_argument('--staged', action='store_true')
group.add_argument('--tracked', action='store_true')
group.add_argument('--paths', nargs='+', help='Explicit file list for GitHub API uploads')
args = parser.parse_args()
root = Path(__file__).resolve().parent.parent

if args.paths:
    paths = args.paths
else:
    command = ['git', '-C', str(root)]
    command += ['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'] if args.staged else ['ls-files', '-z']
    paths = [p for p in subprocess.check_output(command).decode().split('\0') if p]

private_dirs = {'.git', '.local', '.build-tools', 'node_modules', '__pycache__',
                '.venv', 'venv', 'data', 'data_bak', 'voiceprints',
                'nemotron-voiceprints', 'uploads', 'transcripts', 'outputs', 'exports'}
private_suffixes = {'.wav', '.pcm', '.mp3', '.m4a', '.flac', '.mp4', '.nemo',
                    '.safetensors', '.pt', '.pth', '.npz', '.npy', '.log',
                    '.pem', '.key', '.p12', '.pfx', '.pyc', '.sqlite', '.sqlite3', '.db'}

def blocked(path):
    p = PurePosixPath(path)
    if p.is_absolute() or '..' in p.parts or '\\' in path:
        return 'path must be relative to this repository'
    if any(part in private_dirs or part.startswith('dist') for part in p.parts[:-1]):
        return 'local data, dependencies or build output'
    if p.parts and p.parts[0] in {'bin', '.cache', 'models'}:
        return 'build output or cache'
    if p.name == '.env' or (p.name.startswith('.env.') and p.name != '.env.example'):
        return 'actual environment configuration'
    if p.suffix.lower() in private_suffixes or any(mark in p.name.lower() for mark in ['.db-', '.sqlite-', '.sqlite3-']):
        return 'private media, model, database, key or runtime output'
    if p.name in {'jwt_secret', 'id_rsa', 'id_ed25519'}:
        return 'credential file'
    return None

errors = [(p, reason) for p in paths if (reason := blocked(p))]
if errors:
    for path, reason in errors:
        print(f'BLOCKED {path}: {reason}')
    raise SystemExit(1)
print(f'Publishing path check passed: {len(paths)} files. Review file contents separately.')
