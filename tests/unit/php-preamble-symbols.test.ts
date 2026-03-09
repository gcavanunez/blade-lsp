import { describe, expect, it } from 'vitest';
import { PhpPreambleSymbols } from '../../src/providers/php-preamble-symbols';

describe('PhpPreambleSymbols', () => {
    it('extracts Folio render params and with variables', () => {
        const source = `<?php
use App\\Models\\Post;
use Illuminate\\View\\View;

render(function (View $view, Post $post) {
    return $view->with('photos', []);
});
?>

{{ $post->title }}
{{ count($photos) }}`;

        const symbols = PhpPreambleSymbols.getSymbols(source);
        expect(symbols).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ name: '$post', type: 'Post', source: 'folio-param' }),
                expect.objectContaining({ name: '$photos', source: 'view-with' }),
            ]),
        );
        expect(symbols.find((item) => item.name === '$view')).toBeUndefined();
    });

    it('extracts Livewire public properties and top-level assignments', () => {
        const source = `<?php
$greeting = 'Hello';

new class extends Component {
    public string $title = '';
    public $content;

    public function save() {
        $local = true;
    }
};
?>`;

        const symbols = PhpPreambleSymbols.getSymbols(source);
        expect(symbols).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ name: '$greeting', source: 'assignment' }),
                expect.objectContaining({ name: '$title', type: 'string', source: 'livewire-prop' }),
                expect.objectContaining({ name: '$content', source: 'livewire-prop' }),
            ]),
        );
        expect(symbols.find((item) => item.name === '$local')).toBeUndefined();
    });
});
