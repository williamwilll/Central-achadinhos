(async function boot(){
  const { createServer } = await import('node:http');
  const { extractProduct,mercadolivreItemId } = await import('./product-parser.js');
  const { officialMLPrice } = await import('./mercadolivre-price.js');
  const {parseShopeeIds,officialShopeeProduct} = await import('./shopee-affiliate.js');
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
  async function getPreview(link){
    let target=marketUrl(link);
    for(let i=0;i<6;i++){
      const mlId=mercadolivreItemId(target.href);
      const mlVerified=mlId && process.env.ML_ACCESS_TOKEN ? await officialMLPrice(mlId) : null;
      // Para links diretos da Shopee, usar API oficial antes da página, que pode bloquear robôs.
      const shopIds=parseShopeeIds(target.href);
      if(shopIds) {
        const verified=await officialShopeeProduct(shopIds);
        if(verified)return {...verified,itemId:shopIds.itemId,source:verified.source||target.hostname};
      }
      const response=await fetch(target,{redirect:'manual',signal:AbortSignal.timeout(8000),headers:{'user-agent':'Mozilla/5.0 (compatible; AchadinhosPreview/1.0)','accept':'text/html'}});
      if(response.status>=300&&response.status<400){
        const location=response.headers.get('location');
        if(!location)throw Error('O redirecionamento não informou um endereço.');
        target=marketUrl(new URL(location,target).href);
        continue;
      }
      if(!response.ok) {
        if(mlVerified) return {...mlVerified,title:'',image:'',category:'',source:target.hostname,
          priceNote:'Preço confirmado pela API oficial do Mercado Livre. Título e imagem não foram liberados; complete manualmente.'};
        throw Error('A loja não disponibilizou os dados deste produto. Preencha manualmente.');
      }
      if(!(response.headers.get('content-type')||'').includes('text/html'))throw Error('O link não retornou uma página HTML.');
      const reader=response.body?.getReader();
      if(!reader)throw Error('Resposta vazia.');
      const chunks=[];let n=0;
      try{
        while(true){const {done,value}=await reader.read();if(done)break;n+=value.byteLength;if(n>1500000)throw Error('A página excedeu o limite de leitura.');chunks.push(value);}
      }finally{await reader.cancel().catch(()=>{});}
      const html=new TextDecoder().decode(Buffer.concat(chunks));
      const product = extractProduct(html,target.href);
      // Algumas páginas da Shopee carregam uma URL canônica com shopId/itemId.
      const canonical=html.match(/<meta\s+[^>]*(?:property|name)=["']og:url["'][^>]*content=["']([^"']+)["']/i)?.[1] || '';
      const canonicalIds=parseShopeeIds(canonical);
      if(canonicalIds) {
        const verified=await officialShopeeProduct(canonicalIds);
        if(verified)return {...verified,itemId:canonicalIds.itemId,source:verified.source||target.hostname};
      }
      if(mlVerified)Object.assign(product,mlVerified);
      else if(product.itemId && process.env.ML_ACCESS_TOKEN) {
        const official=await officialMLPrice(product.itemId);
        if(official)Object.assign(product,official);
      }
      return {
        ...product,
        source: target.hostname,
        priceNote: product.priceNote || (product.price === null
          ? (product.itemId
              ? 'Preço indisponível nesta consulta. A API oficial exige credencial válida; confira o anúncio ou configure ML_ACCESS_TOKEN no Render.'
              : 'O link não forneceu preço nem identificador confiável. Tente o link completo do anúncio; confirme o valor na loja.')
          : 'Preço obtido de ' + product.priceSource + '. Confira no anúncio antes de publicar.')
      };
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
      if(path==='/health')return send(res,200,{ok:true,version:'1.0.3'});
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
