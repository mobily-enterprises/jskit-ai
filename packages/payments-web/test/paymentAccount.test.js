import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createRenderer, defineComponent, h, nextTick, reactive } from 'vue';
import { compileScript, parse } from '@vue/compiler-sfc';

test('billing component preserves read state and guards checkout while leaving authority to the app', async () => {
  const file = new URL('../src/client/components/PaymentAccount.vue', import.meta.url);
  const { descriptor, errors } = parse(await readFile(file, 'utf8'), { filename: file.pathname });
  assert.deepEqual(errors, []);
  const compiled = compileScript(descriptor, { id: 'payment-account', inlineTemplate: true });
  const directory = await mkdtemp(new URL('./.payment-component-', import.meta.url));
  let app;
  try {
    const modulePath = `${directory}/component.mjs`;
    await writeFile(modulePath, compiled.content);
    const { default: PaymentAccount } = await import(pathToFileURL(modulePath));
    const node = (type, text = '') => ({ type, text, props: {}, children: [], parent: null });
    const renderer = createRenderer({
      createElement: node, createText: (text) => node('text', text), createComment: (text) => node('comment', text),
      setText: (item, text) => { item.text = text; },
      setElementText: (item, text) => { item.text = text; item.children = []; },
      patchProp: (item, key, _previous, value) => { item.props[key] = value; },
      parentNode: (item) => item.parent,
      nextSibling: (item) => item.parent?.children[item.parent.children.indexOf(item) + 1] ?? null,
      insert(item, parent, anchor) {
        if (item.parent) item.parent.children.splice(item.parent.children.indexOf(item), 1);
        item.parent = parent;
        const index = anchor ? parent.children.indexOf(anchor) : -1;
        if (index < 0) parent.children.push(item); else parent.children.splice(index, 0, item);
      },
      remove(item) { if (item.parent) item.parent.children.splice(item.parent.children.indexOf(item), 1); }
    });
    const props = reactive({ account: { balance: 23, features: ['export'], subscriptions: [], hasCustomer: true },
      plans: [{ id: 'pro', name: 'Pro', priceLabel: '$10 / month', features: ['export'], renewalCredits: 100, available: true }], canManage: true, pending: false, loading: false, loadError: '',
      canReadHistory: false, history: null, historyLoading: false, historyError: '' });
    const events = [];
    const root = node('root');
    app = renderer.createApp({ render: () => h(PaymentAccount, { ...props, onCheckout: (id) => events.push(['checkout', id]), onPortal: () => events.push(['portal']), onRefresh: () => events.push(['refresh']), onHistory: (request) => events.push(['history', request]), 'onRetry-history': () => events.push(['retry-history']) }) });
    app.component('v-btn', defineComponent({ setup: (_props, { slots }) => () => h('button', {}, slots.default?.()) }));
    app.component('v-skeleton-loader', defineComponent({ setup: () => () => h('div', 'Loading billing') }));
    for (const name of ['v-list', 'v-list-item', 'v-list-item-title', 'v-list-item-subtitle']) {
      app.component(name, defineComponent({ setup: (_props, { slots }) => () => h('div', {}, slots.default?.()) }));
    }
    app.mount(root);
    const all = (item = root) => [item, ...item.children.flatMap((child) => all(child))];
    const text = () => all().map((item) => item.text).join(' ');
    const choose = () => all().find((item) => item.type === 'button' && item.props['aria-label'] === 'Choose Pro');
    assert.match(text(), /23/);
    choose().props.onClick();
    assert.deepEqual(events, [['checkout', 'pro']]);
    props.pending = true;
    await nextTick();
    assert.equal(choose().props.disabled, true);
    choose().props.onClick();
    assert.equal(events.length, 1);
    props.pending = false;
    props.account.subscriptions = [{ id: 'sub_a', planId: 'pro', status: 'past_due', periodEnd: 0 }];
    await nextTick();
    assert.match(text(), /Payment overdue/);
    assert.equal(choose().props.disabled, true);
    props.account.subscriptions = [];
    props.canManage = false;
    await nextTick();
    choose().props.onClick();
    assert.equal(events.length, 1);
    props.loadError = 'Billing could not load';
    await nextTick();
    assert.equal(choose(), undefined);
    assert.match(text(), /Billing could not load/);
    all().find((item) => item.type === 'button').props.onClick();
    assert.deepEqual(events.at(-1), ['refresh']);
    props.loadError = '';
    props.account = null;
    props.loading = true;
    await nextTick();
    assert.match(text(), /Loading billing/);
    assert.equal(choose(), undefined);
    props.loading = false;
    props.account = { balance: 0, features: [], subscriptions: [], hasCustomer: true };
    await nextTick();
    const button = (label) => all().find((item) => item.type === 'button' && all(item).some((child) => child.text === label));
    assert.equal(button('View invoices and transactions'), undefined);
    props.canReadHistory = true;
    await nextTick();
    button('View invoices and transactions').props.onClick();
    assert.deepEqual(events.at(-1), ['history', { collection: 'transactions', after: null }]);
    props.historyLoading = true;
    await nextTick();
    const count = events.length;
    button('View subscription history').props.onClick();
    assert.equal(events.length, count);
    props.historyLoading = false;
    props.history = { collection: 'transactions', items: [{ id: 'in_a', kind: 'invoice', status: 'open', createdAt: '2030-01-01T00:00:00Z', totalLabel: '$12.00', paidLabel: '$0.00' }], nextCursor: 'in_a' };
    await nextTick();
    assert.match(text(), /Invoice in_a/);
    assert.match(text(), /Total: \$12.00/);
    assert.match(text(), /totals do not confirm payment/);
    button('Next billing page').props.onClick();
    assert.deepEqual(events.at(-1), ['history', { collection: 'transactions', after: 'in_a' }]);
    props.historyError = 'History unavailable';
    await nextTick();
    assert.doesNotMatch(text(), /Invoice in_a/);
    assert.equal(button('Next billing page'), undefined);
    button('Retry billing history').props.onClick();
    assert.deepEqual(events.at(-1), ['retry-history']);
    props.historyError = '';
    props.history = { collection: 'transactions', items: [], nextCursor: null };
    await nextTick();
    assert.match(text(), /No billing records found/);
    props.canReadHistory = false;
    await nextTick();
    assert.doesNotMatch(text(), /No billing records found/);
  } finally { app?.unmount(); await rm(directory, { recursive: true, force: true }); }
});
