import json,os,pathlib,subprocess,time,urllib.request
path=pathlib.Path(os.environ.get('HUIJI_READINESS_STATE', str(pathlib.Path.home()/'huiji-p/readiness.json')))
try: state=json.loads(path.read_text())
except (FileNotFoundError,ValueError): state={'failures':0,'last_restart':0}
try:
    with urllib.request.urlopen(os.environ.get('HUIJI_HEALTH_URL', 'http://127.0.0.1:8080/health'),timeout=5) as response:
        result=json.load(response)
        if result.get('status')!='ready': raise RuntimeError('Service is not ready')
    state['failures']=0;state['last_ready']=time.time();state.pop('error',None)
except Exception as error:
    state['failures']+=1;state['error']=str(error)
    if state['failures']>=3 and time.time()-state['last_restart']>600:
        subprocess.run(['systemctl','--user','restart','huiji-p.service'],check=True,timeout=10)
        state['last_restart']=time.time();state['failures']=0
path.write_text(json.dumps(state))
print(json.dumps(state))
