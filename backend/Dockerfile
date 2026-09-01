# StarBuddy backend — PHP-FPM. The same image runs the fpm pool (app),
# queue worker, scheduler, and Reverb; compose overrides the command.
FROM php:8.5-fpm-alpine AS base

# opcache is built into the 8.5 images already; install the rest.
RUN apk add --no-cache postgresql-dev icu-dev libzip-dev \
    && docker-php-ext-install pdo_pgsql intl zip pcntl

# Upload limits big enough for a game screenshot; see the file for why.
COPY docker/uploads.ini /usr/local/etc/php/conf.d/zz-uploads.ini

WORKDIR /var/www/html

FROM composer:2 AS deps
WORKDIR /app
COPY composer.json composer.lock ./
RUN composer install --no-dev --no-scripts --no-autoloader --prefer-dist --no-interaction

FROM base
# Version shown on the website footer, /api/version and the bot. update.sh passes
# git describe; empty means "use the release version from composer.json".
ARG STARBUDDY_VERSION=
ENV STARBUDDY_VERSION=$STARBUDDY_VERSION
COPY --from=deps /app/vendor ./vendor
COPY . .
COPY --from=deps /usr/bin/composer /usr/bin/composer
RUN composer dump-autoload --optimize --no-dev \
    && chown -R www-data:www-data storage bootstrap/cache

USER www-data
EXPOSE 9000
CMD ["php-fpm"]
