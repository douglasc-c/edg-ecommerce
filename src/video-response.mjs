import { createHash } from 'node:crypto';

export const campaignVideoPaths=new Set(['/edg-intro.mp4','/edg-intro-mobile.mp4','/edg-logo-tremor-loop.mp4']);

function matchesIfRange(value,headers){
  if(!value)return true;
  if(value.startsWith('"'))return value===headers.get('ETag');
  if(value.startsWith('W/'))return false;
  const modified=headers.get('Last-Modified');
  return !!modified&&Number.isFinite(Date.parse(value))&&Date.parse(value)===Date.parse(modified);
}

// These small campaign files are served identically by Node and Workers.
// Safari probes MP4s with bytes=0-1 before requesting the remaining data.
export function campaignVideoResponse({method='GET',headers:requestHeaders={}},content,responseHeaders={}){
  const request=new Headers(requestHeaders),headers=new Headers(responseHeaders);
  const size=content.byteLength;
  let etag=headers.get('ETag');
  if(!etag||etag.startsWith('W/'))etag=`"${createHash('sha256').update(content).digest('hex')}"`;
  headers.set('ETag',etag);
  headers.set('Content-Type','video/mp4');
  headers.set('Accept-Ranges','bytes');
  headers.set('Content-Length',String(size));
  headers.delete('Content-Range');
  headers.delete('Content-Encoding');
  headers.delete('Transfer-Encoding');
  headers.delete('Connection');
  headers.delete('Keep-Alive');
  const validators=request.get('If-None-Match');
  if(validators&&validators.split(',').some(value=>value.trim()==='*'||value.trim().replace(/^W\//,'')===etag)){
    headers.delete('Content-Length');
    return {status:304,headers,body:null};
  }
  const full={status:200,headers,body:method==='HEAD'?null:content};
  const range=method==='GET'&&request.get('Range');
  if(!range||!matchesIfRange(request.get('If-Range'),headers))return full;
  // Unsupported units and multipart/invalid syntax may be ignored (full 200).
  const match=/^bytes=(\d*)-(\d*)$/i.exec(range.trim());
  if(!match||(!match[1]&&!match[2]))return full;
  const suffix=!match[1];
  const start=suffix?Math.max(0,size-Number(match[2])):Number(match[1]);
  const end=suffix||!match[2]?size-1:Math.min(Number(match[2]),size-1);
  if(size===0||start>=size||start>end){
    headers.set('Content-Range',`bytes */${size}`);
    headers.set('Content-Length','0');
    return {status:416,headers,body:null};
  }
  headers.set('Content-Range',`bytes ${start}-${end}/${size}`);
  headers.set('Content-Length',String(end-start+1));
  return {status:206,headers,body:content.subarray(start,end+1)};
}
