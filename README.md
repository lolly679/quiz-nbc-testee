# Quiz NBC 540 e 550

Jogo multiplayer (até 25 jogadores) sem dependências: só Node 18+.

## Rodar no computador
    npm start
- Jogadores: http://localhost:3000
- Administrador: http://localhost:3000/admin  (senha padrão: admin123)

Troque a senha com a variável de ambiente ADMIN_PASSWORD.

## Colocar no ar (grátis) no Render
1. Crie um repositório no GitHub e envie estes arquivos.
2. Em render.com: New > Web Service > conecte o repositório.
3. Build Command: (vazio ou `npm install`) · Start Command: `npm start`
4. Em Environment, crie ADMIN_PASSWORD com a senha que você quiser.
5. Abra https://SEU-APP.onrender.com/admin: o QR code do lobby já aponta para o endereço certo.

Obs.: no plano grátis o serviço "dorme" após alguns minutos parado (abra o /admin uns 2 minutos antes da aula)
e as perguntas salvas podem ser apagadas quando ele reinicia. Guarde uma cópia das perguntas.
