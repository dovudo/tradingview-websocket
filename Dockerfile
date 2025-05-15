FROM node:20-alpine

# Создаем рабочую директорию
WORKDIR /app

# Копируем package.json и package-lock.json
COPY package*.json ./

# Устанавливаем зависимости
RUN npm ci --omit=dev

# Копируем скомпилированные файлы
COPY dist/ ./dist/

# Создаем директорию для логов
RUN mkdir -p logs

# Порты
EXPOSE 8081 9100

# Запуск приложения
CMD ["node", "dist/main.js"] 