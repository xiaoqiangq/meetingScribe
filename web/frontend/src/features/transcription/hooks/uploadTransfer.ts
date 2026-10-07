export function uploadTransfer(endpoint: string, formData: FormData, headers: Record<string, string>, onProgress: (percent: number) => void): Promise<unknown> {
                return new Promise<unknown>((resolve, reject) => {
                    const xhr = new XMLHttpRequest();
                    xhr.open('POST', endpoint);
                    xhr.timeout = 30 * 60 * 1000;
                    xhr.ontimeout = () => reject(new Error('Upload timed out')); 
                    Object.entries(headers).forEach(([key, value]) => xhr.setRequestHeader(key, value));
                    xhr.upload.onprogress = event => { if (event.lengthComputable) onProgress(Math.min(100, Math.round(event.loaded / event.total * 100))); };
                    xhr.onerror = () => reject(new Error('Upload failed'));
                    xhr.onabort = () => reject(new Error('Upload cancelled'));
                    xhr.onload = () => {
                        let data; try { data = JSON.parse(xhr.responseText); } catch { reject(new Error('Invalid upload response')); return; }
                        if (xhr.status >= 200 && xhr.status < 300) resolve(data);
                        else reject(new Error(data.error || 'Upload failed'));
                    };
                    xhr.send(formData);
                });
}
