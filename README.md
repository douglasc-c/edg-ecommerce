# EDG Commerce

Loja virtual e painel de operação integrados: catálogo, carrinho persistente, checkout, pedidos, estoque, financeiro, expedição e usuários com permissões por função. Interface em português, responsiva, com área do cliente e área de gestão.

## Executar localmente

Requer **Node.js 24**. O servidor usa HTTP, criptografia e SQLite nativos do Node; não precisa instalar bibliotecas para executar.

```bash
cp .env.example .env
```

Preencha `ADMIN_EMAIL` e `ADMIN_PASSWORD` com uma senha exclusiva de pelo menos 12 caracteres. Depois:

```bash
npm run seed
npm start
```

Abra http://localhost:3000. Entre com o administrador configurado para acessar a gestão. Clientes criam suas próprias contas pela loja. `npm run seed` é repetível e não substitui senhas existentes.

No modo `demo`, o seed cria seis produtos de exemplo. Pagamentos e fretes são **simulados**, com aviso permanente na interface. O cliente pode simular aprovação no detalhe do pedido; nenhuma transação real é executada. Os produtos de exemplo usam símbolos ilustrativos.

## O que está implementado

| Área | Recursos |
|---|---|
| Loja | Busca, categorias, detalhe de produto, preços, disponibilidade e sacola persistente por cliente |
| Checkout | Endereço, cotação no servidor, escolha de frete, reserva de estoque, criação idempotente do pedido |
| Cliente | Cadastro, login, troca de senha, histórico de pedidos, pagamento, cancelamento antes do pagamento e acompanhamento |
| Catálogo | SKU único, categoria, descrição, preço, custo, dimensões, peso, situação e aparência |
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
| Financeiro | Dashboard financeiro, consulta de pedidos, despesas e estornos |
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

Para etiquetas, configure `SHIPPING_FROM_JSON` com remetente completo, documento apropriado (CPF ou CNPJ) e inscrição estadual. Informe a chave da NF-e já emitida ao criar a etiqueta. Criação, compra e impressão são ações separadas; comprar frete utiliza o saldo da conta Melhor Envio e exige confirmação na interface. Não foi contratada nenhuma entrega real.

Atualizações automáticas usam `/api/webhooks/melhorenvio`. Configure `MELHOR_ENVIO_WEBHOOK_SECRET` com o secret do aplicativo integrado e cadastre o endpoint nesse mesmo aplicativo. A assinatura `X-ME-Signature` é conferida sobre o corpo original. Tokens gerados diretamente no painel podem cotar e consultar, mas o webhook depende de aplicativo integrado; nesses casos use o botão **Consultar transportadora**.

A consulta atualiza o código de rastreio e avança para enviado/entregue quando o provedor confirma postagem/entrega. Também registra tentativas sem sucesso e interrupções na linha do tempo. Um link de rastreio externo pode ser informado manualmente para envios fora da integração.

## Testes

```bash
npm run check
npm test
```

Os 16 testes de API/regra de negócio usam o banco em memória e não chamam provedores reais. Também foi executado e aprovado o teste de navegador do fluxo de compra, expedição, entrega e reposição, com inspeção visual em desktop e celular. A integração contínua também executa o fluxo de navegador de demonstração em desktop e verifica navegação em tela móvel. Para repetir os testes de navegador localmente, instale as dependências de desenvolvimento e Chromium:

```bash
npm install
npx playwright install chromium
npm run test:ui
```

## Hospedagem e dados

Há um `Dockerfile` com usuário sem privilégios, volume `/data` e healthcheck. O container é configurado para produção; preencha as credenciais e configure HTTPS no proxy reverso. Execute o seed uma vez no mesmo volume para preparar o administrador, depois remova `ADMIN_PASSWORD` do ambiente de execução.

Use **uma instância do servidor** com disco persistente e backups do SQLite. A aplicação não é adequada a funções Vercel com filesystem efêmero ou múltiplas réplicas compartilhando o banco. Para esse cenário, migre a persistência para PostgreSQL e adicione filas para tarefas externas. Para backup consistente, use a API de backup SQLite ou pare o processo e copie o banco junto aos arquivos WAL/SHM; não copie somente o `.db` enquanto o servidor escreve.

## Limites desta primeira versão

Esta versão cobre o fluxo central de compra e operação. Antes de abrir a loja, precisa de credenciais dos provedores, catálogo real, identidade da loja e hospedagem. APIs externas foram verificadas pela documentação e por testes com respostas controladas; **homologação autenticada ainda é necessária**.

Ainda não inclui: upload/fotografias dos produtos, variações por tamanho/cor, cupons, promoções, emissão de NF-e, cálculo tributário, conciliação automática de taxas, devolução com logística reversa, recuperação de senha por e-mail, verificação de e-mail, notificações por e-mail/WhatsApp, multiestoque e integração de compras com fornecedores.

Na integração de etiquetas, a criação automática está restrita a cotações com **um volume**; serviços com agência obrigatória, XML fiscal ou múltiplos volumes exigem extensão do adaptador ou operação no painel Melhor Envio. Não repetir criação/compra em resposta incerta sem conferir o painel do provedor. Para recuperação automática desses casos e de webhooks perdidos, a próxima evolução deve incluir fila durável e reconciliação periódica.

Listagens administrativas usam limites de 200 pedidos/usuários/movimentações e 500 lançamentos; o saldo do dashboard considera todo o histórico. Implementar paginação antes de grande volume. O gráfico usa magnitude absoluta e não constitui relatório contábil.

## Documentação de referência

- [Mercado Pago: Checkout Pro](https://www.mercadopago.com.br/developers/pt/reference/online-payments/checkout-pro-preferences/overview)
- [Mercado Pago: notificações](https://www.mercadopago.com.br/developers/pt/docs/checkout-pro-preferences/payment-notifications)
- [Melhor Envio: cotação](https://docs.melhorenvio.com.br/reference/calculo-de-fretes-por-produtos)
- [Melhor Envio: criação de etiqueta](https://docs.melhorenvio.com.br/reference/inserir-fretes-no-carrinho)
- [Melhor Envio: webhooks](https://docs.melhorenvio.com.br/docs/webhooks)
