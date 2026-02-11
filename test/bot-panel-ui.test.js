import test from 'node:test';
import assert from 'node:assert/strict';

import {
    UI_ACTIONS,
    canAcceptImageInput,
    getReadyStatus,
    getSettingsButtons,
    renderFieldValue,
    formatSessionPanel
} from '../lib/bot-panel-ui.js';

test('canAcceptImageInput allows only menu_image and wizard_image states', () => {
    assert.equal(canAcceptImageInput({ state: 'menu_image' }), true);
    assert.equal(canAcceptImageInput({ state: 'wizard_image' }), true);
    assert.equal(canAcceptImageInput({ state: 'collecting' }), false);
});

test('getSettingsButtons reflects spoof toggle label', () => {
    const offButtons = getSettingsButtons({ spoofTo: null });
    const onButtons = getSettingsButtons({ spoofTo: '0x123' });

    assert.equal(offButtons[2][1].text, 'Spoof: Off');
    assert.equal(onButtons[2][1].text, 'Spoof: On');
    assert.equal(onButtons[4][0].data, UI_ACTIONS.MENU);
});

test('renderFieldValue handles null, empty, and spaces values', () => {
    assert.equal(renderFieldValue(null), '_not set_');
    assert.equal(renderFieldValue(''), '`(empty)`');
    assert.equal(renderFieldValue('   '), '`(spaces)`');
    assert.equal(renderFieldValue('PEPE'), 'PEPE');
});

test('formatSessionPanel builds expected text and actions', () => {
    const session = {
        token: {
            name: 'Token Name',
            symbol: 'TKN',
            fees: { clankerFee: 300, pairedFee: 300 },
            context: { platform: 'twitter', messageId: '12345' },
            image: 'https://example.com/image.png',
            socials: { x: 'https://x.com/token' },
            spoofTo: null
        }
    };

    const panel = formatSessionPanel(session, '*Control Panel*');
    assert.match(panel.text, /\*Control Panel\*/);
    assert.match(panel.text, /\*Name:\* Token Name/);
    assert.match(panel.text, /\*Fees:\* 6\.00%/);
    assert.equal(panel.buttons[0][0].data, UI_ACTIONS.DEPLOY);
    assert.equal(panel.buttons[1][0].data, UI_ACTIONS.SETTINGS);
});

test('formatSessionPanel uses Validate action when token is not ready', () => {
    const panel = formatSessionPanel({
        token: {
            name: '',
            symbol: '',
            fees: { clankerFee: 300, pairedFee: 300 },
            context: null,
            image: null,
            socials: {},
            spoofTo: null
        }
    }, '*Control Panel*');

    assert.equal(panel.buttons[0][0].text, 'Validate');
});

test('getReadyStatus reports ready with default fields', () => {
    const status = getReadyStatus({ context: null, image: null });
    assert.equal(status.ready, false);
    assert.deepEqual(status.missing, ['name', 'symbol', 'fees']);
    assert.equal(status.hasContext, false);
    assert.equal(status.hasImage, false);
});

test('getReadyStatus marks ready when required fields are valid', () => {
    const status = getReadyStatus({
        name: 'Pepe',
        symbol: 'PEPE',
        fees: { clankerFee: 300, pairedFee: 300 },
        context: { messageId: '123' },
        image: 'https://example.com/image.png'
    });
    assert.equal(status.ready, true);
    assert.deepEqual(status.missing, []);
    assert.equal(status.hasContext, true);
    assert.equal(status.hasImage, true);
});
