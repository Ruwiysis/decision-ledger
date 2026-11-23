import React, { useCallback, useEffect, useState } from 'react';
import ForgeReconciler, {
  Box,
  Button,
  EmptyState,
  Inline,
  LinkButton,
  Lozenge,
  SectionMessage,
  Spinner,
  Stack,
  Strong,
  Text,
  User,
} from '@forge/react';
import { invoke, rovo } from '@forge/bridge';

// Jira issue panel "Related decisions": the top past decisions related to this work item,
// with a warning when the work item may undo one of them.

const AGENT = { type: 'forge', agentKey: 'decision-agent', agentName: 'Decision Keeper' };

const formatDate = (iso) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : 'earlier';

const STATUS = {
  active: { appearance: 'success', text: 'Active' },
  superseded: { appearance: 'moved', text: 'Superseded' },
  reversed: { appearance: 'removed', text: 'Reversed' },
};

const SOURCE = { confluence: 'Confluence', jira: 'Jira', rovo: 'Rovo chat' };

const hasRealRationale = (d) => d.rationale && !d.rationale.startsWith('Section:');

const App = () => {
  const [state, setState] = useState({ loading: true });
  const [rovoError, setRovoError] = useState(null);

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    const res = await invoke('relatedDecisions').catch(() => null);
    if (!res?.ok) return setState({ loading: false, error: res?.error || 'Could not check related decisions.' });
    setState({ loading: false, ...res });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const askKeeper = async () => {
    setRovoError(null);
    try {
      const enabled = await rovo.isEnabled();
      if (!enabled) return setRovoError('Rovo is not enabled on this site, so Decision Keeper is unavailable.');
      await rovo.open({ ...AGENT, prompt: `Does ${state.issueKey} go against any past decision?` });
    } catch {
      setRovoError('Could not open Rovo chat. Try opening Decision Keeper from the Rovo sidebar.');
    }
  };

  if (state.loading && !state.related) {
    return (
      <Inline alignInline="center">
        <Spinner label="Checking past decisions" />
      </Inline>
    );
  }

  if (state.error) {
    return (
      <SectionMessage
        appearance="error"
        title="We couldn't check past decisions"
        actions={[
          <Button key="retry" onClick={load}>
            Retry
          </Button>,
        ]}
      >
        <Text>{state.error}</Text>
      </SectionMessage>
    );
  }

  const related = state.related || [];
  const conflict = related.find((d) => d.id === state.conflictId);

  if (related.length === 0) {
    return (
      <EmptyState
        width="narrow"
        header="No related decisions"
        description="Nothing in the Decision Ledger matches this work item yet. Record decisions with /decision in Confluence or a “Decision:” comment here."
      />
    );
  }

  return (
    <Stack space="space.200">
      {conflict && (
        <SectionMessage
          appearance="warning"
          title="Possible conflict with a past decision"
          actions={[
            ...(conflict.sourceUrl
              ? [
                  <LinkButton key="view" href={conflict.sourceUrl} target="_blank">
                    View discussion
                  </LinkButton>,
                ]
              : []),
            <Button key="ask" appearance="rovo" onClick={askKeeper}>
              Ask Decision Keeper
            </Button>,
          ]}
        >
          <Text>
            On {formatDate(conflict.decidedAt)} the team decided <Strong>“{conflict.title}”</Strong>
            {hasRealRationale(conflict) ? ` because ${conflict.rationale.replace(/\.$/, '')}.` : '.'}
          </Text>
          {(conflict.changeWords || []).length > 0 && (
            <Text color="color.text.subtle" size="small">
              This work item mentions “{conflict.changeWords.join('”, “')}” near {(conflict.matched || []).join(', ')}.
            </Text>
          )}
        </SectionMessage>
      )}

      {rovoError && (
        <SectionMessage appearance="information">
          <Text>{rovoError}</Text>
        </SectionMessage>
      )}

      <Stack space="space.150">
        {related.map((d) => (
          <Box key={d.id} padding="space.100" backgroundColor={d.conflict ? 'color.background.warning' : 'color.background.neutral.subtle'}>
            <Stack space="space.075">
              <Inline space="space.100" alignBlock="center" shouldWrap>
                <Strong>{d.title}</Strong>
                <Lozenge appearance={(STATUS[d.status] || STATUS.active).appearance}>{(STATUS[d.status] || STATUS.active).text}</Lozenge>
              </Inline>
              {hasRealRationale(d) && <Text maxLines={3}>{d.rationale.charAt(0).toUpperCase() + d.rationale.slice(1)}</Text>}
              <Inline space="space.100" alignBlock="center" shouldWrap>
                {d.decidedBy && <User accountId={d.decidedBy} />}
                <Text color="color.text.subtle" size="small">
                  {formatDate(d.decidedAt)} · {SOURCE[d.sourceType] || d.sourceType}
                  {d.spaceOrProject && !d.spaceOrProject.startsWith('~') ? ` · ${d.spaceOrProject}` : ''}
                </Text>
                {d.sourceUrl && (
                  <LinkButton href={d.sourceUrl} target="_blank" appearance="subtle-link" spacing="compact">
                    Open source
                  </LinkButton>
                )}
              </Inline>
            </Stack>
          </Box>
        ))}
      </Stack>

      {!conflict && (
        <Inline spread="space-between" alignBlock="center">
          <Text color="color.text.subtle" size="small">
            No conflicts spotted.
          </Text>
          <Button appearance="rovo" spacing="compact" onClick={askKeeper}>
            Ask Decision Keeper
          </Button>
        </Inline>
      )}
    </Stack>
  );
};

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
