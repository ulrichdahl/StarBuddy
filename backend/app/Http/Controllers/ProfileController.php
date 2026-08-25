<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class ProfileController extends Controller
{
    public function update(Request $request)
    {
        $data = $request->validate([
            'handle' => [
                'nullable', 'string', 'max:60',
                Rule::unique('users', 'handle')->ignore($request->user()->id),
            ],
            // UI language; the list mirrors frontend/src/locales/*.json.
            'locale' => ['sometimes', 'string', Rule::in(['en', 'da'])],
        ]);

        $request->user()->update($data);

        return $request->user()->load('orgs');
    }
}
