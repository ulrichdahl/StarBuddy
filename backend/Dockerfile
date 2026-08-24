# StarMaker backend — PHP-FPM. The same image runs the fpm pool (app),
# queue worker, scheduler, and Reverb; compose overrides the command.
FROM php:8.5-fpm-alpine AS base

# opcache is built into the 8.5 images already; install the rest.
RUN apk add --no-cache postgresql-dev icu-dev libzip-dev \
    && docker-php-ext-install pdo_pgsql intl zip pcntl

WORKDIR /var/www/html

FROM composer:2 AS deps
WORKDIR /app
COPY composer.json composer.lock ./
RUN composer install --no-dev --no-scripts --no-autoloader --prefer-dist --no-interaction

FROM base
COPY --from=deps /app/vendor ./vendor
COPY . .
COPY --from=deps /usr/bin/composer /usr/bin/composer
RUN composer dump-autoload --optimize --no-dev \
    && chown -R www-data:www-data storage bootstrap/cache

USER www-data
EXPOSE 9000
CMD ["php-fpm"]
