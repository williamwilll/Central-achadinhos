(async function boot(){
  const { createServer } = await import('node:http');
  const { readFile, stat } = await import('node:fs/promises');
  const { fileURLToPath } = await import('node:url');
  const { dirname, resolve, extname, sep } = await import('node:path');
  const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'public');
  const PORT=Number(process.env.PORT||3000);
  const MARKETS=['shopee.com.br','shopee.com','shope.ee','mercadolivre.com.br','mercadolivre.com','mercadolibre.com','meli.la','tiktok.com','tiktokshop.com'];
  function marketUrl(input) {
    const u=new URL(input);
    if(u.protocol!=='https:'||u.username||u.password||u.port) throw Error('Apenas links HTTPS das plataformas selecionadas são aceitos.');
    const h=u.hostname.toLowerCase();
    if(!MARKETS.some(m=>h===m||h.endsWith('.'+m))) throw Error('Este link não é de Shopee, Mercado Livre ou TikTok Shop.');
    return u;
  }
  function decode(s){
    return String(s||'').replace(/&(?:amp|quot|apos|lt|gt|nbsp|#(\d+)|#x([a-f0-9]+));/gi,(matched,dec,hex)=>{
      const map={'&amp;':'&','&quot;':'"','&apos;':"'",'&lt;':'<','&gt;':'>','&nbsp;':' '};
      if(map[matched.toLowerCase()]) return map[matched.toLowerCase()];
      const n=Number.parseInt(dec||hex,dec?10:16);
      return n>0&&n<=0x10ffff?String.fromCodePoint(n):matched;
    }).replace(/\s+/g,' ').trim();
  }
  function meta(html,wanted) {
    for(const item of html.matchAll(/<meta\s+[^>]*>/gi)){
      const attrs={};
      for(const a of item[0].matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) attrs[a[1].toLowerCase()]=a[2]??a[3]??a[4];
      const k=(attrs.property||attrs.name||attrs.itemprop||'').toLowerCase();
      if(wanted.includes(k)) return decode(attrs.content);
    }
    return '';
  }
  function explicitPrice(html){
    const amount=meta(html,['product:price:amount','og:price:amount','price']);
    const currency=meta(html,['product:price:currency','og:price:currency','pricecurrency']);
    if(amount && (!currency||currency.toUpperCase()==='BRL') && /^\d{1,8}(?:[.,]\d{1,2})?$/.test(amount)) return Number(amount.replace(',','.'));
    for(const match of html.matchAll(/<script\s+[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)){
      try{
        const stack=[JSON.parse(match[1])];
        let visits=0;
        while(stack.length&&visits++<150){
          const obj=stack.pop();
          if(!obj||typeof obj!=='object') continue;
          if(Array.isArray(obj)){stack.push(...obj.slice(0,50));continue;}
          const type=obj['@type'];
          const product=typeof type==='string'?/product/i.test(type):Array.isArray(type)&&type.some(t=>/product/i.test(t));
          if(product&&obj.offers){
            const offer=Array.isArray(obj.offers)?obj.offers[0]:obj.offers;
            const price=offer?.price??offer?.priceSpecification?.price;
            const cur=offer?.priceCurrency??offer?.priceSpecification?.priceCurrency??obj.priceCurrency;
            if(price!=null&&(!cur||String(cur).toUpperCase()==='BRL')&&/^\d{1,8}(?:[.,]\d{1,2})?$/.test(String(price)))return Number(String(price).replace(',','.'));
          }
          stack.push(...Object.values(obj).filter(v=>v&&typeof v==='object').slice(0,50));
        }
      }catch{}
    }
    return null;
  }
  async function getPreview(link){
    let target=marketUrl(link);
    for(let i=0;i<6;i++){
      const response=await fetch(target,{redirect:'manual',signal:AbortSignal.timeout(8000),headers:{'user-agent':'Mozilla/5.0 (compatible; AchadinhosPreview/1.0)','accept':'text/html'}});
      if(response.status>=300&&response.status<400){
        const location=response.headers.get('location');
        if(!location)throw Error('O redirecionamento não informou um endereço.');
        target=marketUrl(new URL(location,target).href);
        continue;
      }
      if(!response.ok) throw Error('A loja não disponibilizou os dados deste produto. Preencha manualmente.');
      if(!(response.headers.get('content-type')||'').includes('text/html'))throw Error('O link não retornou uma página HTML.');
      const reader=response.body?.getReader();
      if(!reader)throw Error('Resposta vazia.');
      const chunks=[];let n=0;
      try{
        while(true){const {done,value}=await reader.read();if(done)break;n+=value.byteLength;if(n>1500000)throw Error('A página excedeu o limite de leitura.');chunks.push(value);}
      }finally{await reader.cancel().catch(()=>{});}
      const html=new TextDecoder().decode(Buffer.concat(chunks));
      const title=decode(meta(html,['og:title','twitter:title'])||html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]||'').slice(0,180);
      let image='';
      try{const u=new URL(meta(html,['og:image','twitter:image']),target);if(u.protocol==='https:')image=u.href;}catch{}
      const price=explicitPrice(html);
      return {title,image,price,source:target.hostname,priceNote:price==null?'Preço não identificado: preencha o preço real.':'Preço encontrado em metadados públicos: confirme no anúncio antes de publicar.'};
    }
    throw Error('Muitos redirecionamentos. Preencha manualmente.');
  }
  const MIMES={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.webmanifest':'application/manifest+json','.svg':'image/svg+xml','.png':'image/png'};
  function send(res,status,data,type='application/json; charset=utf-8',head=false){
    res.writeHead(status,{'content-type':type,'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer','x-frame-options':'DENY','content-security-policy':"default-src 'self'; img-src 'self' https: data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"});
    if(head)return res.end();
    return res.end(type.includes('json')?JSON.stringify(data):data);
  }
  const server=createServer(async(req,res)=>{
    try{
      const path=new URL(req.url||'/',`http://${req.headers.host||'localhost'}`).pathname;
      if(path==='/health')return send(res,200,{ok:true,version:'1.0.1'});
      if(path==='/api/preview'){
        if(req.method!=='POST')return send(res,405,{error:'Método inválido.'});
        const chunks=[];let size=0;
        for await(const c of req){size+=c.length;if(size>8192)return send(res,413,{error:'Solicitação grande demais.'});chunks.push(c);}
        let body;
        try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{return send(res,400,{error:'JSON inválido.'});}
        if(typeof body.url!=='string'||body.url.length>2000)return send(res,400,{error:'Link inválido.'});
        try{return send(res,200,await getPreview(body.url));}
        catch(e){return send(res,422,{error:e?.message||'Prévia indisponível.'});}
      }
      if(req.method!=='GET'&&req.method!=='HEAD')return send(res,405,{error:'Método inválido.'});
      const loc=path==='/'?'/index.html':path;
      const target=resolve(ROOT,'.'+decodeURIComponent(loc));
      if(target!==ROOT&&!target.startsWith(ROOT+sep))return send(res,403,{error:'Acesso negado.'});
      if(!(await stat(target).catch(()=>null))?.isFile())return send(res,404,{error:'Arquivo não encontrado.'});
      const file=await readFile(target);
      return send(res,200,file,MIMES[extname(target)]||'application/octet-stream',req.method==='HEAD');
    }catch{return send(res,500,{error:'Erro interno.'});}
  });
  server.listen(PORT,'0.0.0.0',()=>console.log('Central de Achadinhos na porta '+PORT));
})();
