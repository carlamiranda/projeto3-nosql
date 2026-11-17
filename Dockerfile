# Imagem do servidor do chat (Node.js)
FROM node:20-alpine

WORKDIR /app
ENV NODE_ENV=production

# Instala as dependências primeiro (fica em cache se só o código mudar).
# "npm ci" usa as versões exatas do package-lock.json: o build é igual em qualquer máquina.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copia o resto do projeto
COPY . .

# Roda sem ser root (mais seguro)
USER node

EXPOSE 3000
CMD ["node", "server.js"]
