# Monitor legal Aferium

Vigia as fontes oficiais da Biblioteca Legal (leis, portarias, instruções normativas) duas vezes por dia e avisa o sistema quando algo muda. **Só avisa**: toda mudança exige revisão humana antes de alterar qualquer procedimento.

## Como funciona
1. O GitHub roda `scripts/scan.mjs` às 06:17 e às 18:17 (Maceió), de graça, em repositório público.
2. Para cada fonte o monitor lê a página ou o PDF, calcula uma impressão digital e compara com a leitura anterior. Cada leitura é confirmada duas vezes para evitar falso alarme.
3. O resultado é gravado em `public/legal/` (`status.json`, `history.json`, `text/`). O histórico do próprio GitHub guarda o que mudou e quando.
4. O Aferium lê esses arquivos e mostra na Biblioteca Legal: monitoramento ativo, alterações encontradas e fontes sem resposta.

Uma fonte que não responde só conta como indisponível depois de 4 varreduras seguidas (dois dias), para não gerar alarme por instabilidade de site público.

## Ativar (uma vez)
1. Crie a conta em https://github.com/signup (pode usar aferiumquality@gmail.com).
2. Abra o Cloud Shell, envie este ZIP, extraia e rode:
   ```
   unzip -o AFERIUM_MONITOR_LEGAL.zip && cd AFERIUM_MONITOR_LEGAL && bash scripts/ativar-monitor.sh
   ```
   O script cria o repositório público `aferium-legal-monitor`, envia os arquivos e roda a primeira varredura. No fim ele mostra `usuario/aferium-legal-monitor`.
3. Ligue no site já publicado (pasta `hosting` do pacote do site):
   ```
   node scripts/ligar-no-site.mjs ~/AFERIUM_..._DEMO/hosting usuario/aferium-legal-monitor
   cd ~/AFERIUM_..._DEMO/hosting && firebase deploy --only hosting --project aferiumdemo --non-interactive
   ```
4. Nos próximos pacotes, informe `usuario/aferium-legal-monitor` em `branding.legalRepository` da instalação e o site já sai ligado.

## Conferir
- No GitHub, aba **Actions**: a execução «Monitor legal Aferium» deve estar verde.
- No Aferium, **Biblioteca Legal** mostra «Monitoramento atualizado». A tela só afirma isso depois da segunda leitura (o script já faz a confirmação).

## Limites
- O monitor detecta que o conteúdo mudou; quem decide se afeta a empresa é o responsável técnico.
- Sites do governo às vezes ficam fora do ar ou bloqueiam acesso automático. Fontes assim aparecem como «aguardando nova tentativa».
- O GitHub pode pausar agendamentos de repositórios sem atividade por 60 dias; como cada varredura publica um commit, isso não deve ocorrer. Se ocorrer, reative em Actions.
