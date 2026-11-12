# 静的ファイルを nginx で配信する
FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY index.html styles.css *.js /usr/share/nginx/html/
EXPOSE 80
