<?php

namespace App\Support;

use App\Jobs\NotifyDiscordUser;
use App\Models\Org;
use App\Models\User;

/**
 * Direct messages about org requests, in each recipient's own language:
 * managers hear that someone asked to join, the player hears they are in.
 * Nothing is sent when the bot is not set up.
 */
class OrgRequestNotice
{
    private const TEXT = [
        'en' => [
            'requested_title' => '{player} asked to join {org}',
            'requested_body' => 'Accept or decline them in StarBuddy: Organizations › {org} › Members.',
            'accepted_title' => 'You are in {org}',
            'accepted_body' => 'Your request to join {org} was accepted. Your org-visible stock is now shared with your org mates, and your points count for {org}.',
            'open' => 'Open StarBuddy',
        ],
        'da' => [
            'requested_title' => '{player} har bedt om at blive medlem af {org}',
            'requested_body' => 'Godkend eller afvis i StarBuddy: Organisationer › {org} › Medlemmer.',
            'accepted_title' => 'Du er med i {org}',
            'accepted_body' => 'Din anmodning om at blive medlem af {org} er godkendt. Dit org-synlige lager deles nu med dine org-kammerater, og dine point tæller for {org}.',
            'open' => 'Åbn StarBuddy',
        ],
    ];

    public static function requested(Org $org, User $player): void
    {
        $managers = $org->memberships()
            ->wherePivot('status', 'active')
            ->wherePivotIn('role', ['manager', 'admin'])
            ->whereNotNull('discord_id')
            ->get();

        foreach ($managers as $manager) {
            self::send($manager, 'requested', ['player' => $player->handle ?? $player->name, 'org' => $org->name]);
        }
    }

    public static function accepted(Org $org, User $player): void
    {
        self::send($player, 'accepted', ['org' => $org->name]);
    }

    private static function send(User $to, string $kind, array $vars): void
    {
        if (! $to->discord_id || ! config('starbuddy.bot_api_token')) {
            return;
        }
        $text = self::TEXT[$to->locale === 'da' ? 'da' : 'en'];
        $fill = fn (string $s) => strtr($s, collect($vars)->mapWithKeys(fn ($v, $k) => ["{{$k}}" => $v])->all());
        $url = rtrim((string) config('app.url'), '/');

        NotifyDiscordUser::dispatch($to->discord_id, [
            'title' => $fill($text["{$kind}_title"]),
            'description' => $fill($text["{$kind}_body"])."\n\n[{$text['open']}]({$url})",
            'color' => 0x4FD1C5,
        ]);
    }
}
