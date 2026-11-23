import React, { useCallback, useEffect, useMemo, useState } from 'react';
import ForgeReconciler, {
  Box,
  Button,
  ButtonGroup,
  DatePicker,
  DynamicTable,
  EmptyState,
  Heading,
  Inline,
  Label,
  Link,
  LinkButton,
  Lozenge,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  ModalTransition,
  SectionMessage,
  Select,
  Spinner,
  Stack,
  Strong,
  Tag,
  TagGroup,
  Text,
  Textfield,
  User,
} from '@forge/react';
import { invoke } from '@forge/bridge';

// Confluence global page: the team's Decision Ledger.

const STATUS_OPTIONS = [
  { label: 'All statuses', value: '' },
  { label: 'Active', value: 'active' },
  { label: 'Superseded', value: 'superseded' },
  { label: 'Reversed', value: 'reversed' },
];

const STATUS_LOZENGE = {
  active: { appearance: 'success', text: 'Active' },
  superseded: { appearance: 'moved', text: 'Superseded' },
  reversed: { appearance: 'removed', text: 'Reversed' },
};

const SOURCE_LABEL = {
  confluence: 'Confluence page',
  jira: 'Jira work item',
  rovo: 'Rovo chat',
};

const formatDate = (iso) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—';

const truncate = (s, n) => (s && s.length > n ? `${s.slice(0, n - 1)}…` : s || '');

// Rationales are often captured mid-sentence ("Because: the team…"): capitalise for display.
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

const StatusLozenge = ({ status }) => {
  const s = STATUS_LOZENGE[status] || STATUS_LOZENGE.active;
  return <Lozenge appearance={s.appearance}>{s.text}</Lozenge>;
};

/**
 * "Connected work" from Teamwork Graph: people who contributed to the decision's page and
 * pages it links to. Loads independently so the modal never waits on it or breaks because of it.
 */
const ConnectedWork = ({ decision }) => {
  const [state, setState] = useState({ loading: true });

  useEffect(() => {
    let alive = true;
    setState({ loading: true });
    invoke('connectedWork', { id: decision.id })
      .then((res) => alive && setState({ loading: false, ...(res?.ok ? res : { status: 'unavailable' }) }))
      .catch(() => alive && setState({ loading: false, status: 'unavailable' }));
    return () => {
      alive = false;
    };
  }, [decision.id]);

  if (state.status === 'unsupported') return null;

  return (
    <Stack space="space.075">
      <Inline space="space.100" alignBlock="center">
        <Heading as="h3" size="xsmall">
          Connected work
        </Heading>
        <Lozenge appearance="new">Teamwork Graph</Lozenge>
      </Inline>
      {state.loading && <Spinner size="small" label="Loading connected work" />}
      {!state.loading && state.status === 'unavailable' && (
        <Text color="color.text.subtle">Connected work isn't available right now.</Text>
      )}
      {!state.loading && state.status === 'empty' && (
        <Text color="color.text.subtle">No other contributors or linked pages found for this decision's page.</Text>
      )}
      {!state.loading && state.status === 'ok' && (
        <Stack space="space.100">
          {(state.people || []).length > 0 && (
            <Stack space="space.050">
              <Text size="small" color="color.text.subtle">
                People who shaped the page
              </Text>
              <Inline space="space.100" shouldWrap>
                {(state.people || []).map((p) => (
                  <User key={p.accountId} accountId={p.accountId} />
                ))}
              </Inline>
            </Stack>
          )}
          {(state.pages || []).length > 0 && (
            <Stack space="space.050">
              <Text size="small" color="color.text.subtle">
                Linked pages
              </Text>
              {(state.pages || []).map((p) => (
                <Link key={p.url} href={p.url} openNewTab>
                  {p.title}
                </Link>
              ))}
            </Stack>
          )}
        </Stack>
      )}
    </Stack>
  );
};

const DecisionModal = ({ decision, allDecisions, onClose, onChanged }) => {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [replacement, setReplacement] = useState(null);

  const replacementOptions = useMemo(
    () =>
      (allDecisions || [])
        .filter((d) => d.id !== decision.id && d.status === 'active')
        .map((d) => ({ label: truncate(d.title, 80), value: d.id })),
    [allDecisions, decision.id]
  );

  const changeStatus = async (status) => {
    setSaving(true);
    setError(null);
    const res = await invoke('setStatus', { id: decision.id, status, supersededBy: replacement?.value || null }).catch(() => null);
    setSaving(false);
    if (!res?.ok) return setError(res?.error || 'Could not update the decision.');
    onChanged(res.decision);
  };

  const supersededByTitle = decision.supersededBy
    ? (allDecisions || []).find((d) => d.id === decision.supersededBy)?.title
    : null;

  return (
    <Modal onClose={onClose} width="large" label={decision.title}>
      <ModalHeader>
        <ModalTitle isMultiline>{decision.title}</ModalTitle>
      </ModalHeader>
      <ModalBody>
        <Stack space="space.200">
          <Inline space="space.100" alignBlock="center" shouldWrap>
            <StatusLozenge status={decision.status} />
            <Text color="color.text.subtle">
              {SOURCE_LABEL[decision.sourceType] || decision.sourceType}
              {decision.spaceOrProject ? ` · ${decision.spaceOrProject}` : ''} · {formatDate(decision.decidedAt)}
            </Text>
          </Inline>
          {error && (
            <SectionMessage appearance="error" title="Something went wrong">
              <Text>{error}</Text>
            </SectionMessage>
          )}
          <Stack space="space.050">
            <Heading as="h3" size="xsmall">
              Why
            </Heading>
            <Text>{cap(decision.rationale) || 'No rationale was recorded with this decision.'}</Text>
          </Stack>
          {decision.decidedBy && (
            <Stack space="space.050">
              <Heading as="h3" size="xsmall">
                Decided by
              </Heading>
              <User accountId={decision.decidedBy} />
            </Stack>
          )}
          {(decision.topics || []).length > 0 && (
            <Stack space="space.050">
              <Heading as="h3" size="xsmall">
                Topics
              </Heading>
              <TagGroup>
                {(decision.topics || []).map((t) => (
                  <Tag key={t} text={t} />
                ))}
              </TagGroup>
            </Stack>
          )}
          <ConnectedWork decision={decision} />
          {decision.status === 'superseded' && supersededByTitle && (
            <SectionMessage appearance="information" title="Superseded">
              <Text>
                Replaced by: <Strong>{supersededByTitle}</Strong>
              </Text>
            </SectionMessage>
          )}
          {decision.status === 'active' && replacementOptions.length > 0 && (
            <Stack space="space.050">
              <Label labelFor="replacement">Superseded by (optional)</Label>
              <Select
                id="replacement"
                inputId="replacement"
                options={replacementOptions}
                value={replacement}
                onChange={setReplacement}
                isClearable
                placeholder="Pick the decision that replaces this one"
              />
            </Stack>
          )}
        </Stack>
      </ModalBody>
      <ModalFooter>
        <ButtonGroup label="Decision actions">
          {decision.sourceUrl && (
            <LinkButton href={decision.sourceUrl} target="_blank">
              Open source
            </LinkButton>
          )}
          {decision.status === 'active' ? (
            <Button appearance="warning" isDisabled={saving} onClick={() => changeStatus('superseded')}>
              {saving ? 'Saving…' : 'Mark superseded'}
            </Button>
          ) : (
            <Button isDisabled={saving} onClick={() => changeStatus('active')}>
              {saving ? 'Saving…' : 'Mark active again'}
            </Button>
          )}
          <Button appearance="primary" onClick={onClose}>
            Close
          </Button>
        </ButtonGroup>
      </ModalFooter>
    </Modal>
  );
};

const App = () => {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState(STATUS_OPTIONS[0]);
  const [space, setSpace] = useState(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [spaces, setSpaces] = useState([]);
  const [rows, setRows] = useState(null); // null = first load
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null);
  const [submitted, setSubmitted] = useState('');

  const load = useCallback(async (q) => {
    setLoading(true);
    setError(null);
    const res = await invoke('listDecisions', {
      query: q,
      status: status?.value || '',
      space: space?.value || '',
      from,
      to,
    }).catch(() => null);
    setLoading(false);
    if (!res?.ok) {
      setError(res?.error || 'Could not load decisions. Please try again.');
      setRows((r) => r || []);
      return;
    }
    setRows(res.decisions || []);
  }, [status, space, from, to]);

  useEffect(() => {
    load(submitted);
  }, [load, submitted]);

  useEffect(() => {
    invoke('listFilters')
      .then((res) => res?.ok && setSpaces(res.spaces || []))
      .catch(() => {});
  }, []);

  const filtersActive = !!(submitted || status?.value || space || from || to);
  const clearFilters = () => {
    setQuery('');
    setSubmitted('');
    setStatus(STATUS_OPTIONS[0]);
    setSpace(null);
    setFrom('');
    setTo('');
  };

  const spaceOptions = (spaces || []).map((s) => ({
    label: `${s.key} (${s.sourceType === 'jira' ? 'Jira space' : 'Confluence space'})`,
    value: s.key,
  }));

  const head = {
    cells: [
      { key: 'title', content: 'Decision', isSortable: true, width: 30 },
      { key: 'why', content: 'Why', width: 28 },
      { key: 'status', content: 'Status', isSortable: true, width: 10 },
      { key: 'by', content: 'Decided by', width: 14 },
      { key: 'date', content: 'Date', isSortable: true, width: 9 },
      { key: 'source', content: 'Source', width: 9 },
    ],
  };

  const tableRows = (rows || []).map((d) => ({
    key: String(d.id),
    cells: [
      {
        key: d.title,
        content: (
          <Button appearance="subtle" spacing="compact" onClick={() => setSelected(d)}>
            {truncate(d.title, 70)}
          </Button>
        ),
      },
      { key: 'why', content: <Text maxLines={2}>{cap(d.rationale) || '—'}</Text> },
      { key: d.status, content: <StatusLozenge status={d.status} /> },
      { key: 'by', content: d.decidedBy ? <User accountId={d.decidedBy} /> : <Text>—</Text> },
      { key: d.decidedAt || '', content: <Text>{formatDate(d.decidedAt)}</Text> },
      {
        key: 'source',
        content: d.sourceUrl ? (
          <LinkButton href={d.sourceUrl} target="_blank" appearance="subtle-link" spacing="compact">
            {d.sourceType === 'confluence' ? 'Page' : d.sourceType === 'jira' ? 'Work item' : 'Chat'}
          </LinkButton>
        ) : (
          <Text>{SOURCE_LABEL[d.sourceType] || '—'}</Text>
        ),
      },
    ],
  }));

  const emptyView = filtersActive ? (
    <EmptyState
      header="No decisions match"
      description="Try different keywords, or clear the filters to see the whole ledger."
      primaryAction={<Button onClick={clearFilters}>Clear filters</Button>}
    />
  ) : (
    <EmptyState
      header="Your Decision Ledger is empty"
      description="Decisions appear here automatically. Add a Decision (type /decision) to a Confluence page, comment “Decision: … Because: …” on a Jira work item, or ask Decision Keeper in Rovo to log one."
    />
  );

  return (
    <Box padding="space.300">
      <Stack space="space.300">
        <Stack space="space.100">
          <Heading as="h1" size="large">
            Decision Ledger
          </Heading>
          <Text color="color.text.subtle">
            Every decision your team has made, with who made it, when and why. Captured from Confluence, Jira and
            Rovo.
          </Text>
        </Stack>

        <Inline space="space.150" alignBlock="end" shouldWrap>
          <Stack space="space.050">
            <Label labelFor="search">Search</Label>
            <Inline space="space.050">
              <Textfield
                id="search"
                width={260}
                placeholder="e.g. database, payments, hiring"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <Button iconBefore="search" onClick={() => setSubmitted(query.trim())}>
                Search
              </Button>
            </Inline>
          </Stack>
          <Stack space="space.050">
            <Label labelFor="status">Status</Label>
            <Select inputId="status" options={STATUS_OPTIONS} value={status} onChange={(v) => setStatus(v || STATUS_OPTIONS[0])} />
          </Stack>
          <Stack space="space.050">
            <Label labelFor="space">Space</Label>
            <Select
              inputId="space"
              options={spaceOptions}
              value={space}
              onChange={setSpace}
              isClearable
              placeholder="All spaces"
            />
          </Stack>
          <Stack space="space.050">
            <Label labelFor="from">From</Label>
            <DatePicker id="from" value={from} onChange={(v) => setFrom(v || '')} placeholder="Any date" />
          </Stack>
          <Stack space="space.050">
            <Label labelFor="to">To</Label>
            <DatePicker id="to" value={to} onChange={(v) => setTo(v || '')} placeholder="Any date" />
          </Stack>
          {filtersActive && (
            <Button appearance="subtle" onClick={clearFilters}>
              Clear filters
            </Button>
          )}
        </Inline>

        {error && (
          <SectionMessage
            appearance="error"
            title="We couldn't load the ledger"
            actions={[
              <Button key="retry" onClick={() => load(submitted)}>
                Retry
              </Button>,
            ]}
          >
            <Text>{error}</Text>
          </SectionMessage>
        )}

        {rows === null ? (
          <Inline alignInline="center">
            <Spinner size="large" label="Loading decisions" />
          </Inline>
        ) : (
          <Stack space="space.100">
            {!loading && rows.length > 0 && (
              <Text color="color.text.subtle">
                {rows.length} decision{rows.length === 1 ? '' : 's'}
                {submitted ? ` matching “${submitted}”, best match first` : ''}
              </Text>
            )}
            {/* Search results keep the server's relevance order; plain listings sort by date.
                The key remounts the table so a previous column sort doesn't override relevance. */}
            <DynamicTable
              key={submitted ? `search-${submitted}` : 'list'}
              label="Decisions"
              head={head}
              rows={tableRows}
              rowsPerPage={10}
              isLoading={loading}
              emptyView={emptyView}
              {...(submitted ? {} : { defaultSortKey: 'date', defaultSortOrder: 'DESC' })}
            />
          </Stack>
        )}
      </Stack>

      <ModalTransition>
        {selected && (
          <DecisionModal
            decision={selected}
            allDecisions={rows}
            onClose={() => setSelected(null)}
            onChanged={(updated) => {
              setSelected(updated);
              setRows((list) => (list || []).map((d) => (d.id === updated.id ? updated : d)));
            }}
          />
        )}
      </ModalTransition>
    </Box>
  );
};

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
