# EDG Commerce

Loja virtual e painel de operação integrados: catálogo, carrinho persistente, checkout, pedidos, estoque, financeiro, expedição e usuários com permissões por função. Interface em português, responsiva, com área do cliente e área de gestão.

## Executar localmente

Requer **Node.js 24**. O servidor usa HTTP, criptografia e SQLite nativos do Node. A biblioteca Sharp valida e otimiza as fotos. Instale as dependências com `npm ci` antes de executar.

```bash
cp .env.example .env
```

Preencha `ADMIN_EMAIL` e `ADMIN_PASSWORD` com uma senha exclusiva de pelo menos 12 caracteres. Depois:

```bash
npm ci
npm run seed
npm start
```

Abra http://localhost:3000. Entre com o administrador configurado para acessar a gestão. Clientes criam suas próprias contas pela loja. `npm run seed` é repetível e não substitui senhas existentes.

No modo `demo`, o seed cria seis produtos de exemplo. Pagamentos e fretes são **simulados**, com aviso permanente na interface. O cliente pode simular aprovação no detalhe do pedido; nenhuma transação real é executada. Os produtos de exemplo usam símbolos ilustrativos até que você envie as fotos pelo painel.

## O que está implementado

| Área | Recursos |
|---|---|
| Loja | Busca, categorias, detalhe de produto, preços, disponibilidade e sacola persistente por cliente |
| Checkout | Endereço, cotação no servidor, escolha de frete, reserva de estoque, criação idempotente do pedido |
| Cliente | Cadastro, login, troca de senha, histórico de pedidos, pagamento, cancelamento antes do pagamento e acompanhamento |
| Catálogo | SKU único, categoria, descrição, preço, custo, dimensões, peso, situação, galeria de fotos e cadastro fiscal |
| Cupons | Percentual ou valor fixo, mínimo de compra, teto de desconto, período, limite total e limite por cliente |
| NF-e | Emissão Focus NFe, consulta de autorização, DANFE/XML com acesso autenticado, cancelamento e chave integrada à etiqueta |
| Recuperação | Link por e-mail, uso único, expiração, revogação de sessões e fila com retentativas via Resend |
| Estoque | Saldo físico, reservado e disponível, alertas de reposição e histórico de entradas/saídas com responsável |
| Pedidos | Pagamento, separação, embalagem, envio, entrega, cancelamento, estorno e linha do tempo |
| Financeiro | Receitas confirmadas, estornos integrais/parciais, despesas, saldo e exportação CSV |
| Expedição | Cotação Melhor Envio, criação de etiqueta comercial com chave de NF-e, compra de frete, impressão e rastreio |
| Gestão | Dashboard, perfis por função, bloqueio de usuários, revogação de sessões e auditoria |

## Permissões

| Perfil | Acessos |
|---|---|
| Administrador | Todas as operações |
| Estoque | Dashboard operacional, catálogo, ajustes de estoque e consulta de pedidos |
| Financeiro | Dashboard financeiro, pedidos, despesas, estornos, cupons e emissão fiscal |
| Expedição | Dashboard operacional, consulta de pedidos, separação, embalagem, envio, entrega e etiquetas |
| Atendimento | Dashboard operacional e consulta de pedidos |
| Cliente | Sua sacola e seus próprios pedidos |

As permissões são conferidas pelo servidor. O cadastro público sempre cria um cliente, independentemente de campos adicionais enviados. O cliente não recebe os custos internos dos itens nem identificadores internos de pagamentos e etiquetas.

## Regras da operação

- Valores monetários são inteiros em centavos. O servidor calcula preços e totais; valores enviados pelo navegador não definem a cobrança.
- Cotações duram 10 minutos e são vinculadas ao cliente, CEP e conteúdo do carrinho, incluindo dimensões e preços.
- O checkout reserva unidades em transação SQLite. A aprovação baixa estoque físico e libera a reserva **uma vez**.
- A reserva dura 30 minutos por padrão. Expiração e cancelamento liberam as unidades. A manutenção executa a cada minuto e também antes de operações relevantes.
- Pagamento tardio após expiração tenta baixar unidades ainda disponíveis. Se faltarem unidades, o pedido vai para **pagamento em análise** e deve ser estornado pelo financeiro. Um pedido cancelado com pagamento tardio sempre exige análise.
- Somente pagamentos aprovados, sem estorno parcial, podem seguir para expedição. Transições manuais obedecem à ordem; envio exige código de rastreio.
- Estorno confirmado repõe estoque automaticamente apenas antes da expedição. Depois do envio, a equipe deve conferir a devolução e lançar a entrada no estoque.
- Webhooks duplicados não duplicam receitas, baixas de estoque ou estornos. Notificações atrasadas de envio não fazem um pedido entregue voltar para enviado.
- Uma segunda cobrança para um pedido já pago fica registrada na auditoria (`payment.duplicate`) e precisa de análise no gateway; não há nova baixa de estoque.

## Pagamentos reais: Mercado Pago

Defina `COMMERCE_MODE=live`, `APP_URL` com sua origem pública HTTPS e:

- `MERCADO_PAGO_ACCESS_TOKEN`;
- `MERCADO_PAGO_WEBHOOK_SECRET`;
- `MERCADO_PAGO_COLLECTOR_ID` (ID da conta recebedora).

O checkout cria uma preferência de **Checkout Pro** e redireciona para a página do Mercado Pago. Os meios disponíveis dependem da conta e do provedor. O sistema não captura nem armazena dados de cartão.

Cadastre `https://SEU-DOMINIO/api/webhooks/mercadopago` nas notificações de pagamento da aplicação. O endpoint valida a assinatura e consulta o pagamento na API oficial antes de conferir pedido, recebedor, moeda e valor. O retorno do navegador nunca confirma pagamento.

Valide aprovação, pendência, rejeição, expiração e estorno com as contas de teste antes de operar. Não foram executadas cobranças reais nem testes autenticados no provedor durante a implementação.

## Frete real: Melhor Envio

Configure `MELHOR_ENVIO_TOKEN`, `SUPPORT_EMAIL`, `ORIGIN_POSTAL_CODE` e `MELHOR_ENVIO_SANDBOX`. As cotações usam pesos e dimensões do catálogo, preço customizado e prazo customizado retornados pela API.

Para etiquetas, configure `SHIPPING_FROM_JSON` com remetente completo, documento apropriado (CPF ou CNPJ) e inscrição estadual. Ao emitir a NF-e pelo sistema, a chave autorizada em produção é reutilizada na etiqueta. Também é possível informar uma chave externa quando o pedido não tem emissão integrada. Criação, compra e impressão são ações separadas; comprar frete utiliza o saldo da conta Melhor Envio e exige confirmação na interface. Não foi contratada nenhuma entrega real.

Atualizações automáticas usam `/api/webhooks/melhorenvio`. Configure `MELHOR_ENVIO_WEBHOOK_SECRET` com o secret do aplicativo integrado e cadastre o endpoint nesse mesmo aplicativo. A assinatura `X-ME-Signature` é conferida sobre o corpo original. Tokens gerados diretamente no painel podem cotar e consultar, mas o webhook depende de aplicativo integrado; nesses casos use o botão **Consultar transportadora**.

A consulta atualiza o código de rastreio e avança para enviado/entregue quando o provedor confirma postagem/entrega. Também registra tentativas sem sucesso e interrupções na linha do tempo. Um link de rastreio externo pode ser informado manualmente para envios fora da integração.

## Testes

```bash
npm run check
npm test
```

Os testes de API/regra de negócio usam o banco em memória e não chamam provedores reais. Também foi executado e aprovado o teste de navegador do fluxo de compra, expedição, entrega e reposição, com inspeção visual em desktop e celular. A integração contínua também executa o fluxo de navegador de demonstração em desktop e verifica navegação em tela móvel. Para repetir os testes de navegador localmente, instale as dependências de desenvolvimento e Chromium:

```bash
npm install
npx playwright install chromium
npm run test:ui
```

## Hospedagem e dados

Há um `Dockerfile` com usuário sem privilégios, volume `/data` e healthcheck. O container é configurado para produção; preencha as credenciais e configure HTTPS no proxy reverso. Execute o seed uma vez no mesmo volume para preparar o administrador, depois remova `ADMIN_PASSWORD` do ambiente de execução.

Use **uma instância do servidor** com disco persistente e backups do SQLite. A aplicação não é adequada a funções Vercel com filesystem efêmero ou múltiplas réplicas compartilhando o banco. Para esse cenário, migre a persistência para PostgreSQL e adicione filas para tarefas externas. Para backup consistente, use a API de backup SQLite ou pare o processo e copie o banco junto aos arquivos WAL/SHM; não copie somente o `.db` enquanto o servidor escreve.

## Limites desta primeira versão

Esta versão cobre compra, operação, fotos, cupons, recuperação de senha e integração de emissão de NF-e. Antes de abrir a loja, precisa de credenciais dos provedores, catálogo real, identidade da loja e hospedagem. APIs externas foram verificadas pela documentação e por testes com respostas controladas; **homologação autenticada ainda é necessária**.

Ainda não inclui: variações por tamanho/cor, cálculo tributário automático, conciliação automática de taxas, devolução com logística reversa, verificação de e-mail, notificações de venda por e-mail/WhatsApp, multiestoque e integração de compras com fornecedores. A emissão fiscal usa os dados tributários configurados e revisados; não determina automaticamente regime, CFOP, CSOSN, DIFAL, IBS/CBS ou alíquotas.

Na integração de etiquetas, a criação automática está restrita a cotações com **um volume**; serviços com agência obrigatória, XML fiscal ou múltiplos volumes exigem extensão do adaptador ou operação no painel Melhor Envio. Não repetir criação/compra em resposta incerta sem conferir o painel do provedor. Para recuperação automática desses casos e de webhooks perdidos, a próxima evolução deve incluir fila durável e reconciliação periódica.

Listagens administrativas usam limites de 200 pedidos/usuários/movimentações e 500 lançamentos; o saldo do dashboard considera todo o histórico. Implementar paginação antes de grande volume. O gráfico usa magnitude absoluta e não constitui relatório contábil.

## Documentação de referência

- [Mercado Pago: Checkout Pro](https://www.mercadopago.com.br/developers/pt/reference/online-payments/checkout-pro-preferences/overview)
- [Mercado Pago: notificações](https://www.mercadopago.com.br/developers/pt/docs/checkout-pro-preferences/payment-notifications)
- [Melhor Envio: cotação](https://docs.melhorenvio.com.br/reference/calculo-de-fretes-por-produtos)
- [Melhor Envio: criação de etiqueta](https://docs.melhorenvio.com.br/reference/inserir-fretes-no-carrinho)
- [Melhor Envio: webhooks](https://docs.melhorenvio.com.br/docs/webhooks)


## Fotos dos produtos

No painel **Produtos**, abra o editor e envie JPEG, PNG ou WebP, com até 5 MB por arquivo e oito fotos por produto. A primeira foto é a capa. Salve o produto após o upload; imagens podem ser removidas da galeria no editor.

O servidor decodifica a imagem, limita a quantidade de pixels, corrige a orientação, reduz para até 1280 px e gera um JPEG sem metadados. SVG e arquivos inválidos não são aceitos. A foto otimizada é guardada no SQLite, no mesmo armazenamento persistente da aplicação; portanto, os backups também incluem as imagens. Uploads sem associação podem permanecer armazenados e precisam de limpeza administrativa futura.

## Cupons

Administradores e financeiro podem criar e ativar/desativar cupons. Percentuais usam centésimos de percentual internamente; valores fixos, mínimos e tetos usam centavos. O desconto só se aplica aos produtos e mantém pelo menos um centavo para evitar pedidos gratuitos enviados ao gateway.

O checkout recalcula as regras em transação com a reserva de estoque. Pedidos pendentes reservam um uso do cupom; cancelamento/expiração liberam. Pagamento confirma o uso, e estorno não permite reutilizar a promoção. Depois de ter pedidos vinculados, as condições não podem ser editadas: desative e crie outro código. Pagamentos tardios mantêm o desconto contratado e podem consumir um uso que já tinha sido liberado; o limite evita novos checkouts, sem alterar retroativamente uma cobrança.

O desconto é rateado em centavos exatos entre os itens no checkout do Mercado Pago e na NF-e, preservando o total do pedido. As condições futuras de um cupom não alteram pedidos já criados.

## Recuperação de senha por e-mail

Configure `RESEND_API_KEY`, `EMAIL_FROM` (remetente verificado no Resend) e `EMAIL_ENCRYPTION_KEY` (32 bytes em hexadecimal, estável). Não coloque essas chaves no navegador. O endpoint público não revela se uma conta existe.

O link dura 30 minutos, pode ser utilizado uma vez e contém um token aleatório cujo hash fica no banco. Uma nova solicitação invalida o link anterior; a troca de senha revoga as sessões e os demais links da conta. Troca manual de senha e alteração de acesso pelo administrador também invalidam links pendentes.

A mensagem entra em fila persistente, com conteúdo criptografado por AES-256-GCM e até cinco tentativas. O servidor processa a fila a cada minuto. A chave de envio é idempotente e o conteúdo criptografado é apagado após confirmação de envio. Guarde a chave de criptografia com segurança; perder ou alterar essa chave impede o envio de mensagens pendentes. Aceitação pelo Resend não garante entrega na caixa do destinatário; confira o painel do provedor para rejeições, supressões e devoluções.

No modo demo, a mensagem não é enviada: o administrador vê o texto e o link em **E-mails**, para testar o fluxo. Essa visualização de conteúdo não existe no modo live. A chave criptográfica da simulação é guardada no banco para permitir reiniciar o ambiente. Ao alternar entre demo e live, links e mensagens pendentes são invalidados.

## Emissão de NF-e

Integração de **NF-e de mercadorias via Focus NFe**. Configure a empresa e os recursos necessários no provedor, seu `FOCUS_NFE_TOKEN`, `NFE_EMITTER_JSON`, `NFE_DEFAULTS_JSON` e `NFE_ENVIRONMENT=homologation` para iniciar.

O emitente segue o formato Focus NFe: CNPJ, nome, inscrição estadual, regime tributário e endereço. Os parâmetros gerais devem incluir natureza da operação, modalidade de frete, consumidor final e indicador de inscrição estadual do destinatário, além dos demais campos exigidos para sua operação.

Cadastre NCM, CFOP, unidade, origem e situações tributárias de ICMS, PIS e COFINS no produto. Campos tributários adicionais podem ser informados no editor avançado. **Classificações, bases de cálculo, valores de tributos e alíquotas precisam ser configurados e revisados pelo responsável contábil para cada operação.** O sistema preserva um snapshot fiscal dos produtos no pedido; alterações posteriores no catálogo não mudam a venda anterior. Pedidos antigos sem cadastro fiscal podem ser completados na revisão da emissão.

No detalhe de um pedido pago, antes do envio, clique em **Emitir NF-e**, confira os itens fiscais e confirme. Informe também o código fiscal do meio efetivamente recebido e seus dados complementares (inclusive credenciadora/autorização quando aplicáveis). A integração não presume que todo pagamento do Mercado Pago seja PIX ou cartão. O servidor deriva preços, quantidades, destinatário, desconto, frete e valor do pagamento do pedido. Não é possível alterar esses valores enviando dados fiscais arbitrários. Esta implementação cobre venda de mercadorias com totais já contratados; operações que adicionam valores como IPI/ST ao total do pedido precisam de extensão do cálculo comercial antes da emissão.

Cada pedido tem uma referência fiscal persistente. Emissão pode ficar em processamento: use **Consultar situação** até a autorização. Uma falha de comunicação fica marcada como incerta e impede novo envio até a consulta. Se a consulta confirmar que não há nota no provedor, é possível reenviar usando a mesma referência; rejeições podem ser corrigidas e reenviadas. A aplicação não troca a referência para contornar uma resposta incerta.

DANFE e XML ficam disponíveis no pedido, por rotas autenticadas. Clientes só acessam documentos dos seus próprios pedidos. Para contratar a etiqueta real, a emissão vinculada precisa estar autorizada em produção; notas simuladas, de homologação, canceladas ou pendentes não servem para essa etiqueta. Envios manuais com nota vinculada também exigem autorização no ambiente correto.

Cancelamento de NF-e exige justificativa e confirmação do provedor, e é bloqueado pela aplicação após expedição. O prazo e as condições de autorização/cancelamento são decididos pelo provedor/SEFAZ. Cancelamento fiscal e estorno financeiro são operações separadas. Cartas de correção, inutilização, notas de devolução e NF-e complementar ainda não fazem parte deste módulo.

O modo demo simula autorização e cancelamento, sem enviar dados à SEFAZ e sem gerar DANFE/XML reais. No modo live, homologação é identificada na interface e usa o endpoint específico; produção exige `NFE_ENVIRONMENT=production`, token apropriado e dados revisados. Não foi emitida nota fiscal real durante a implementação. A homologação autenticada da sua empresa ainda é necessária.

As migrações para o esquema v2 são automáticas e preservam cadastros e pedidos existentes; faça backup antes de atualizar uma instalação. O processamento fiscal é consultado pelo operador; não há webhook Focus NFe nem consulta fiscal automática nesta versão.

- [Focus NFe: emissão](https://doc.focusnfe.com.br/reference/emitir_nfe)
- [Focus NFe: consulta](https://doc.focusnfe.com.br/reference/consultar_nfe)
- [Focus NFe: cancelamento](https://doc.focusnfe.com.br/reference/cancelar_nfe)
- [Resend: envio](https://resend.com/docs/api-reference/emails/send-email)
