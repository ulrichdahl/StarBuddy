<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class RsiIncident extends Model
{
    protected $fillable = [
        'slug', 'title', 'severity', 'resolved', 'informational', 'affected',
        'body_html', 'permalink', 'started_at', 'rsi_updated_at', 'resolved_at', 'body_hash',
    ];

    protected function casts(): array
    {
        return [
            'resolved' => 'boolean',
            'informational' => 'boolean',
            'affected' => 'array',
            'started_at' => 'datetime',
            'rsi_updated_at' => 'datetime',
            'resolved_at' => 'datetime',
        ];
    }

    /** Payload shared by the web app, the desktop client and the bot. */
    public function toAlert(): array
    {
        return [
            'id' => $this->id,
            'slug' => $this->slug,
            'title' => $this->title,
            'severity' => $this->severity,
            'resolved' => $this->resolved,
            'informational' => $this->informational,
            'affected' => $this->affected ?? [],
            'body_html' => $this->body_html,
            'body_text' => \App\Support\RsiStatus::plainText($this->body_html),
            'shutdown_at' => \App\Support\RsiStatus::shutdownTime($this->body_html, $this->started_at)?->toIso8601String(),
            'permalink' => $this->permalink,
            'started_at' => $this->started_at?->toIso8601String(),
            'updated_at' => $this->rsi_updated_at?->toIso8601String(),
            'resolved_at' => $this->resolved_at?->toIso8601String(),
            'version' => $this->body_hash,
        ];
    }
}
