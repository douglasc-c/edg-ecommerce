# Publicar a loja e preparar estoque sem credenciais bancárias

O projeto inclui um Worker pronto para **modo catálogo**, com cadastro real de produtos, fotos, preços, estoque, movimentações e usuários. A vitrine fica disponível e informa “Loja em preparação”. Carrinho, cotação, checkout, pagamento simulado e webhooks de pagamento/envio estão bloqueados na API. Nada é cobrado ou reservado pelo catálogo.

O `wrangler.jsonc` usa `COMMERCE_MODE=catalog` e `STORE_CURRENCY=EUR`. Não é necessário informar credenciais do banco espanhol, Mercado Pago ou Melhor Envio nesta etapa. A integração europeia de checkout e faturação continua pendente; mudar somente para `live` não habilita pagamentos em euros.

## 1. Atualizar o projeto

Depois de integrar a PR, na pasta do repositório:

```bash
git switch master
git pull
npm ci
npx wrangler login
```

Use Node 24. Se você criou um Worker por um assistente de templates, conecte este repositório: o código e a configuração deste projeto substituem o template.

## 2. Publicar o Worker

```bash
npm run deploy
```

O comando cria o Worker `edg-ecommerce` e seu banco SQLite persistente em um Durable Object. Não é preciso criar D1, preencher `database_id`, criar bucket R2 ou executar seed. As migrações de schema são aplicadas automaticamente. Nenhum produto de exemplo é inserido.

Anote a URL HTTPS retornada, por exemplo `https://edg-ecommerce.seu-subdominio.workers.dev`.

## 3. Configurar a URL e o administrador

```bash
npx wrangler secret put APP_URL
npx wrangler secret put ADMIN_EMAIL
npx wrangler secret put ADMIN_PASSWORD
```

Digite cada valor quando o terminal pedir:

| Configuração | Valor |
| --- | --- |
| `APP_URL` | A URL HTTPS exata do Worker ou domínio próprio, sem caminho. |
| `ADMIN_EMAIL` | Seu e-mail para entrar na administração. |
| `ADMIN_PASSWORD` | Uma senha exclusiva com 12 a 128 caracteres. |

A URL e o e-mail são guardados como secrets para não serem sobrescritos pelo próximo deploy. Não cole senhas em arquivos ou commits. Antes de configurar os três valores, a vitrine estática pode carregar, mas a API retorna indisponibilidade.

Abra a loja. O primeiro acesso à API cria o administrador. Entre com o e-mail e a senha e abra **Gestão** (ou `/#admin`). Depois de confirmar o login, pode remover `ADMIN_PASSWORD` com `npx wrangler secret delete ADMIN_PASSWORD`: a conta já está persistida. Alterar esse secret depois não muda a senha de uma conta existente; use “Minha conta” para trocar a senha.

## 4. Preparar produtos e estoque

1. Em **Produtos**, cadastre SKU, nome, categoria, descrição, preço/custo em euros e fotos. Peso e dimensões são preservados para a futura integração logística.
2. Use **Inativo** para manter um produto fora da vitrine enquanto o prepara.
3. Em **Estoque**, registre o saldo inicial e reposições com motivo. As movimentações ficam no histórico.
4. Abra **Ver loja** para revisar a vitrine. Os preços são exibidos em euros, e as compras ficam indisponíveis.
5. Em **Usuários**, crie acessos da equipe com o perfil adequado. A recuperação por e-mail só fica disponível após configurar Resend, remetente e chave de criptografia.

O editor aceita JPEG, PNG e WebP até 5 MB; normaliza para JPEG de até 1280 × 1280 antes do envio. O Worker valida e reencoda o JPEG, removendo metadados. Produtos podem ter até oito fotos.

## Pelo painel do Cloudflare conectado ao GitHub

Em **Workers & Pages → Create → Import a repository**, selecione `douglasc-c/edg-ecommerce` após integrar a PR.

| Campo | Configuração |
| --- | --- |
| Branch de produção | `master` |
| Diretório raiz | `/` (raiz do repositório) |
| Comando de build | `npm ci` |
| Comando de deploy | `npm run deploy` |
| Versão Node | `24` |

A configuração de bindings está no `wrangler.jsonc`. Depois do primeiro deploy, adicione `APP_URL`, `ADMIN_EMAIL` e `ADMIN_PASSWORD` em **Settings → Variables and Secrets**, como secrets, e aplique as alterações.

## Persistência, lojas e atualizações

Produtos, fotos, contas, sessões, movimentações e pedidos ficam no SQLite do Durable Object. A vitrine é entregue como assets do Worker. Deploys preservam os dados. Mantenha o nome do Worker, a classe `CommerceStore`, o binding `STORE` e o nome interno `primary`: renomeá-los pode apontar para outro banco. Não exclua o Worker/namespace para atualizar a aplicação.

Essa implantação usa uma loja por Worker. Para Brasil e Europa, publique Workers separados com configurações próprias e dados/estoques isolados. A moeda é uma configuração por loja: alterar `EUR` para `BRL` muda a exibição, não converte valores. Configure a moeda antes de cadastrar o catálogo. A arquitetura atual concentra o banco em um objeto; para volume elevado, reavalie particionamento e imagens em R2.

O cron a cada cinco minutos processa manutenção e e-mails configurados. Reservas também expiram ao consultar produtos/pedidos. Em catálogo não há novas reservas. Dados locais de testes não são enviados para produção.

## Validar antes do deploy

```bash
npm run check
npm test
npm run test:cloudflare
npm run test:ui
```

O teste de Workers compila o pacote, executa no runtime do Cloudflare e confirma autenticação, autorização, fotos, produtos, estoque, bloqueio de compras e persistência após reinicialização. Não exige conta Cloudflare.

Referências: [SQLite em Durable Objects](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/), [Wrangler](https://developers.cloudflare.com/workers/wrangler/configuration/).
