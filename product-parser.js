// Extrai somente dados públicos atribuídos ao produto; nunca estima preço.
function normalize(s) {
  return String(s ?? '').replace(/&(?:amp|quot|apos|lt|gt|nbsp|#(\d+)|#x([a-f0-9]+));/gi, (found, dec, hex) => {
    const named = { '&amp;': '&', '&quot;': '"', '&apos;': "'", '&lt;': '<', '&gt;': '>', '&nbsp;': ' ' };
    if (named[found.toLowerCase()]) return named[found.toLowerCase()];
    const cp = parseInt(dec || hex, dec ? 10 : 16);
    return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : found;
  }).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}
function attrs(tag) {
  const result = Object.create(null);
  for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) {
    result[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4];
  }
  return result;
}
function readMeta(html) {
  const entries = new Map();
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const a = attrs(match[0]);
    const key = (a.property || a.name || a.itemprop || '').toLowerCase();
    if (key && a.content && !entries.has(key)) entries.set(key, normalize(a.content));
  }
  return entries;
}
function jsonld(html) {
  const nodes = [];
  for (const script of html.matchAll(/<script\b[^>]*>[\s\S]*?<\/script>/gi)) {
    const start = script[0].slice(0,script[0].indexOf('>')+1);
    if (!/application\/ld\+json/i.test(attrs(start).type || '')) continue;
    try {
      const body = script[0].slice(start.length).replace(/<\/script>$/i,'').trim();
      const stack = [JSON.parse(body)];
      let steps = 0;
      while (stack.length && steps++ < 250) {
        const entry = stack.pop();
        if (!entry || typeof entry !== 'object') continue;
        if (Array.isArray(entry)) { stack.push(...entry.slice(0,80)); continue; }
        nodes.push(entry);
        if (entry['@graph']) stack.push(entry['@graph']);
      }
    } catch { /* marcação malformada: ignorar sem quebrar o cadastro */ }
  }
  return nodes;
}
function isType(node, type) {
  const kinds = Array.isArray(node?.['@type']) ? node['@type'] : [node?.['@type']];
  return kinds.some(kind => typeof kind === 'string' && new RegExp('(?:^|[/#])' + type + '$','i').test(kind));
}
export function parseBRLPrice(value) {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 && value <= 10000000 ? Math.round(value * 100) / 100 : null;
  let text = String(value ?? '').trim().replace(/^(?:R\$|BRL)\s*/i,'').replace(/\s/g,'');
  if (!text) return null;
  if (/^\d{1,3}(?:\.\d{3})+,\d{1,2}$/.test(text)) text = text.replace(/\./g,'').replace(',','.');
  else if (/^\d{1,3}(?:,\d{3})+\.\d{1,2}$/.test(text)) text = text.replace(/,/g,'');
  else if (/^\d+,\d{1,2}$/.test(text)) text = text.replace(',','.');
  else if (!/^\d+(?:\.\d{1,2})?$/.test(text)) return null;
  const n = Number(text);
  return Number.isFinite(n) && n > 0 && n <= 10000000 ? n : null;
}
function currencyOK(code, brazil) {
  const currency = String(code ?? '').trim().toUpperCase();
  return currency === 'BRL' || (!currency && brazil);
}
function validCategory(value) {
  const text = normalize(value).replace(/^[›>/\s]+|[›>/\s]+$/g,'').slice(0,60);
  if (!text || text.length < 3 || /^[A-Z]{2,5}\d{2,}$/i.test(text) || /^\d+$/.test(text)) return '';
  if (/(^| )(?:(?:início|home|página inicial|mercado livre|shopee|tiktok shop|todos os produtos|ofertas|loja|departamentos))$/i.test(text)) return '';
  return text;
}
function inference(title) {
  const t = normalize(title).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  const rules = [
    ['Moda', /\b(calca|jeans|camiseta|blusa|vestido|shorts|saia|roupa|body|jaqueta|camisa|tenis|bota|sandalia|cropped|legging|moda|cowgirl|country|rodeio|bolsa)\b/],
    ['Eletrônicos', /\b(fone|smartphone|celular|notebook|fone bluetooth|smartwatch|teclado|monitor|computador|tablet|carregador|power bank)\b/],
    ['Casa e Decoração', /\b(panela|tapete|almofada|cortina|cama|mesa|cadeira|luminaria|cozinha|organizador|copos|jarra|edredom)\b/],
    ['Beleza', /\b(perfume|maquiagem|batom|cosmetico|hidratante|shampoo|secador de cabelo|unha)\b/],
    ['Ferramentas', /\b(furadeira|parafusadeira|chave de fenda|martelete|serra circular|alicate|broca|ferramenta)\b/],
    ['Automotivo', /\b(automotivo|carro|moto|pneu|farol|retrovisor|capacete)\b/],
    ['Esportes', /\b(bicicleta|musculacao|academia|halter|futebol|esporte|raquete|esteira)\b/],
    ['Infantil', /\b(brinquedo|bebe|infantil|mamadeira|boneca|carrinho de bebe)\b/],
    ['Pet Shop', /\b(cachorro|gato|coleira|pet shop|racao|arranhador)\b/]
  ];
  return rules.find(([,pattern])=>pattern.test(t))?.[0] || '';
}
function nodesFromProduct(node) {
  return Array.isArray(node.offers) ? node.offers : node.offers ? [node.offers] : [];
}
function breadcrumbCategory(nodes, title) {
  for (const node of nodes) {
    if (!isType(node,'BreadcrumbList') || !Array.isArray(node.itemListElement)) continue;
    const named = node.itemListElement.map(x=>normalize(x?.name || x?.item?.name || '')).filter(Boolean);
    const useful = named.filter(x=>validCategory(x) && x.toLocaleLowerCase('pt-BR') !== normalize(title).toLocaleLowerCase('pt-BR'));
    if (useful.length) return validCategory(useful.at(-1));
  }
  return '';
}
export function extractProduct(html, url) {
  const page = new URL(url);
  const brazil = /(?:^|\.)mercadolivre\.com\.br$|(?:^|\.)shopee\.com\.br$/i.test(page.hostname);
  const tags = readMeta(html);
  const nodes = jsonld(html);
  const product = nodes.find(node=>isType(node,'Product'));
  const title = normalize(product?.name || tags.get('og:title') || tags.get('twitter:title') || html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').slice(0,180);
  let image = '';
  const imageCandidate = (Array.isArray(product?.image) ? product.image[0] : product?.image) || tags.get('og:image') || tags.get('twitter:image');
  try {
    const img = new URL(typeof imageCandidate === 'string' ? imageCandidate : imageCandidate?.url, page);
    if (img.protocol === 'https:') image = img.href;
  } catch {}
  let price = null;
  let priceSource = '';
  const currency = tags.get('product:price:currency') || tags.get('og:price:currency') || tags.get('pricecurrency');
  const metaPrice = tags.get('product:price:amount') || tags.get('og:price:amount') || tags.get('price');
  if (currencyOK(currency, brazil)) {
    const n = parseBRLPrice(metaPrice);
    if (n != null) {price = n; priceSource = 'Metadados públicos da loja';}
  }
  if (price === null && product) {
    const values = nodesFromProduct(product).filter(offer=>currencyOK(offer?.priceCurrency || offer?.priceSpecification?.priceCurrency || product?.priceCurrency, brazil))
      .map(offer=>parseBRLPrice(offer?.price ?? offer?.priceSpecification?.price)).filter(x=>x !== null);
    const distinct = [...new Set(values)];
    if (distinct.length === 1) {price = distinct[0];priceSource = 'Oferta estruturada do produto';}
  }
  const categoryDirect = validCategory(product?.category || tags.get('product:category') || tags.get('og:category') || tags.get('article:section'));
  const categoryBreadcrumb = breadcrumbCategory(nodes,title);
  const category = categoryDirect || categoryBreadcrumb || inference(title);
  const categorySource = categoryDirect ? 'Loja' : categoryBreadcrumb ? 'Navegação da loja' : category ? 'Sugestão pelo título' : '';
  return {title,image,price,category,categorySource,priceSource};
}
