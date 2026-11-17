# Imagem do servidor do chat (Node.js)
FROM node:20-alpine

WORKDIR /app

# Instala as dependências primeiro (fica em cache se o código mudar)
COPY package.json ./
RUN npm install --omit=dev

# Copia o resto do projeto
COPY . .

EXPOSE 3000
CMD ["node", "server.js"]
