# Central de Achadinhos — v1.0.1

Painel web gratuito para organizar ofertas de afiliados do Mercado Livre, Shopee e TikTok Shop e preparar publicações para WhatsApp.

## Funcionalidades

- Cadastro, edição e remoção de ofertas, preços, fotos, cupons e links de afiliados
- Busca, filtros, seleção para publicações e compartilhamento manual
- Prévia de informações públicas de produto via API `/api/preview` (pode falhar quando a loja restringe acesso)
- Exportação CSV e backup/restauração JSON
- Layout responsivo para celular

## Executar

Node.js 20 ou mais recente. Execute `npm start`, e acesse `http://localhost:3000`. Teste com `npm test`.

## Render

Conecte o repositório como Web Service gratuito, runtime Node, branch main, comando de build `npm install && npm test` e de inicialização `npm start`. A rota `/health` responde ao health check.

## Limitações

**Os dados são salvos somente no armazenamento do navegador** (localStorage). O servidor não mantém um banco de produtos; faça backups JSON regularmente. Não há autenticação individual ou múltiplos usuários.

Os preços obtidos por metadados podem ser imprecisos ou estar desatualizados; revise sempre antes de publicar. A plataforma não calcula comissões, não consulta vendas, não obtém preços automaticamente em segundo plano nem envia mensagens diretamente para grupos/canais do WhatsApp. O compartilhamento é manual.

Não informe senhas ou chaves de API no painel. Este projeto não possui afiliação oficial com os marketplaces ou WhatsApp.
