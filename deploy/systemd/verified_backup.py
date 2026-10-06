#!/usr/bin/env python3
"""Consistent backups with a restore test. Temporary recording content is excluded.
No directory or batch deletion, including backup retention: pruning is manual.
"""
import argparse, datetime, hashlib, json, os, pathlib, sqlite3, tarfile
base = pathlib.Path(os.environ.get('HUIJI_HOME', str(pathlib.Path.home()/'huiji-p'))).resolve()
data = pathlib.Path(os.environ.get('HUIJI_DATA_DIR', str(base/'data'))).resolve()
backup = pathlib.Path(os.environ.get('HUIJI_BACKUP_DIR', str(base/'backups'))).resolve()
backup.mkdir(mode=0o700, parents=True, exist_ok=True)
os.umask(0o077)
args = argparse.ArgumentParser()
args.add_argument('--media', action='store_true')
options = args.parse_args()
now = datetime.datetime.now(datetime.timezone.utc)
tag = now.strftime('%Y%m%dT%H%M%SZ')
destination = backup/f'database-{tag}.sqlite'
source = sqlite3.connect(f'file:{data}/scriberr.db?mode=ro', uri=True, timeout=60)
snapshot = sqlite3.connect(destination)
source.backup(snapshot)
source.close()
quick_ids = 'SELECT id FROM transcription_jobs WHERE is_quick = 1'
for table, column in [('transcription_job_executions','transcription_job_id'),('summaries','transcription_id'),('notes','transcription_id'),('speaker_mappings','transcription_job_id')]:
    snapshot.execute(f'DELETE FROM {table} WHERE {column} IN ({quick_ids})')
snapshot.execute("UPDATE transcription_jobs SET transcript=NULL,summary=NULL,audio_path='',audio_bytes=0,quick_cleanup_files='[]' WHERE is_quick=1")
snapshot.commit()
if snapshot.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
    raise RuntimeError('Backup integrity check failed')
restored = sqlite3.connect(':memory:')
snapshot.backup(restored)
if restored.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
    raise RuntimeError('Backup restore failed')
ordinary = restored.execute('SELECT count(*) FROM transcription_jobs WHERE is_quick=0').fetchone()[0]
if ordinary != snapshot.execute('SELECT count(*) FROM transcription_jobs WHERE is_quick=0').fetchone()[0]:
    raise RuntimeError('Restored recording count differs')
report = {'created_at':now.isoformat(), 'database':destination.name, 'integrity':'ok', 'restore':'ok','ordinary_recordings':ordinary, 'quick_content_excluded':True}
def digest(path):
    with open(path,'rb') as stream:
        return hashlib.file_digest(stream,'sha256').hexdigest() if hasattr(hashlib,'file_digest') else hash_stream(stream)
def hash_stream(stream):
    result=hashlib.sha256()
    while True:
        block=stream.read(1024*1024)
        if not block: break
        result.update(block)
    return result.hexdigest()
report['database_sha256'] = digest(destination)
# Sunday media backup; the first deployment also explicitly invokes --media.
if options.media or now.astimezone().weekday()==6:
    files=set()
    def add_file(path):
        path=pathlib.Path(path)
        if not path.is_file(): return
        resolved=path.resolve()
        if path.is_symlink() or resolved != path.absolute(): raise RuntimeError(f'Symlink backup refused: {path}')
        if data not in resolved.parents: raise RuntimeError(f'Backup path outside storage: {path}')
        if data/'uploads/quick_transcriptions' in resolved.parents: return
        files.add(path)
    for job_id, audio_path in snapshot.execute('SELECT id,audio_path FROM transcription_jobs WHERE is_quick=0'):
        if audio_path:
            # Convert container paths to their actual host mount.
            add_file(audio_path.replace('/app/data/',str(data)+'/') if audio_path.startswith('/app/data/') else audio_path)
        output=data/'transcripts'/job_id
        if output.exists():
            for path in output.rglob('*'):
                if path.is_file(): add_file(path)
    for path, in snapshot.execute('SELECT file_path FROM multi_track_files WHERE transcription_job_id IN (SELECT id FROM transcription_jobs WHERE is_quick=0)'):
        add_file(path.replace('/app/data/',str(data)+'/') if path.startswith('/app/data/') else path)
    add_file(data/'jwt_secret')
    archive=backup/f'media-{tag}.tar.gz'
    expected={}
    with tarfile.open(archive,'w:gz') as tar:
        for path in sorted(files):
            name=str(path.relative_to(data))
            expected[name]=digest(path)
            tar.add(path,arcname=name,recursive=False)
    with tarfile.open(archive,'r:gz') as tar:
        for member in tar:
            if not member.isfile(): raise RuntimeError('Unexpected non-file archive member')
            with tar.extractfile(member) as stream:
                if hash_stream(stream)!=expected[member.name]: raise RuntimeError(f'Archive verification failed: {member.name}')
    report['media_archive']=archive.name
    report['verified_media_files']=len(expected)
    report['media_sha256']=digest(archive)
    report['media_members']=expected
snapshot.close()
restored.close()
(backup/f'verification-{tag}.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
print(json.dumps({k:v for k,v in report.items() if k!='media_members'},ensure_ascii=False))
