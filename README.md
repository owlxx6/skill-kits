# Skill Kits

## Ce que fait le projet

Un pipeline hebdomadaire explore GitHub, filtre les dépôts de skills et fait relire chaque skill par un LLM. Il en tire un catalogue de kits de skills, un kit par projet d'agent. La curation se fait par pull request : le pipeline propose, le mainteneur valide. Le site public est un plan distinct, à venir.

## Installation locale

Prérequis : Node 22 ou plus récent.

Installer les dépendances (terminal, à la racine du projet) :

```bash
npm ci
```

Créer le fichier d'environnement (terminal, à la racine du projet) :

```bash
cp .env.example .env
```

Renseigner dans `.env` :

- `GITHUB_TOKEN` : un jeton avec accès en lecture aux dépôts publics ;
- `ANTHROPIC_API_KEY` : la clé de l'API Anthropic.

Ne jamais committer `.env`.

## Commandes

Toutes les commandes se lancent dans un terminal, à la racine du projet.

```bash
npm test
```

Lance les tests unitaires et d'intégration (sans réseau, sans dépense).

```bash
npm run typecheck
```

Vérifie les types TypeScript.

```bash
npm run pipeline -- all
```

Lance toutes les étapes : discover, filter, extract, review, rank, summary. Cette commande appelle GitHub et l'API Anthropic (payante).

```bash
npm run pipeline -- all --dry-run
```

Lance un essai réduit :

- les 5 premiers dépôts de `data/sources.yaml` seulement ;
- aucune recherche par topics ;
- 40 revues complètes au plus ;
- tout s'écrit sous `.dry-run/` ; le vrai cache n'est pas touché.

Pour mesurer à nouveau le coût et la durée, supprimer `.dry-run/` à la main avant de relancer. Sinon, les revues déjà faites sont reprises du cache et ne coûtent rien. Pour la première mesure, chronométrer :

```bash
time npm run pipeline -- all --dry-run
```

Le mode d'essai affiche les jetons consommés par skill relu.

```bash
npm run pipeline -- rank summary
```

Relance seulement les étapes `rank` et `summary` : aucun appel réseau ni LLM. Utile pour régénérer `catalog.json` et le résumé après une modification de `data/curation.yaml`.

## Validation hebdomadaire

Chaque lundi, le workflow ouvre une pull request `Pipeline run <date>`. Son corps est le résumé du passage. Il contient :

- **Candidats** : par kit, les collections et skills proposés, avec identifiant, score et « Why it's here » ;
- **Relus** : les fiches approuvées dont le contenu a changé et qui ont été relues ;
- **Retirés** : les fiches approuvées sorties du kit, avec la raison : `review score <note> below 6` (note de revue sous le seuil `review.minCatalogScore`), `security severe` (alerte de sécurité sévère), `repository no longer listed` (dépôt absent de la liste filtrée : archivé, supprimé, licence changée, inactif ou renommé), `collection below 3 skills or with no skill in the catalog` (le dépôt reste listé mais n'est plus une collection ; les copies identiques d'un même skill dans un dépôt comptent pour un seul, au seuil comme dans le score), `skill no longer found in the repository` (le dépôt reste listé mais le dossier du skill n'y est plus, ou l'identifiant est mal écrit), `not found in the catalog` (tout autre cas). Un dépôt renommé fait apparaître ses anciens identifiants comme `repository no longer listed` et figure dans la section « Renamed repositories » ;
- **En attente de relecture** : les fiches approuvées modifiées, masquées du kit tant qu'elles ne sont pas relues ;
- **Dépôts renommés** : à mettre à jour dans `data/curation.yaml` et `data/sources.yaml` si besoin ;
- **Échecs** : skills ou dépôts non traités.

Pour décider, éditer `data/curation.yaml` sur la branche de la pull request :

- ajouter un identifiant à `approved` pour l'intégrer au kit ; l'ordre de la liste est l'ordre d'affichage ;
- l'ajouter à `rejected` pour ne plus le proposer.

Puis fusionner la pull request.

Fusionner ou fermer chaque pull request du pipeline avant le lundi suivant : le workflow refuse de démarrer tant qu'une est ouverte.

## Changer la liste des kits

Ajouter ou retirer un kit dans `data/kits.yaml`, ou modifier le titre ou la description d'un kit, change la liste des kits. Le tri et les revues en dépendent. Avant de relancer le pipeline, supprimer :

- `data/cache/triage.json`
- `data/cache/reviews/`
- `data/cache/kits.sha256`

Sans cela, le pipeline refuse de relire. Après la réinitialisation, toutes les fiches approuvées sont masquées (« en attente ») jusqu'à leur nouvelle revue.

## Premier lancement sur GitHub

- [ ] Pousser le dépôt avec `main` comme branche par défaut (les workflows planifiés ne tournent que depuis la branche par défaut).
- [ ] Ajouter le secret `ANTHROPIC_API_KEY` (Settings > Secrets and variables > Actions).
- [ ] Activer « Allow GitHub Actions to create and approve pull requests » (Settings > Actions > General > Workflow permissions).
- [ ] Ne pas exiger la CI comme vérification obligatoire sur `main` : les pull requests ouvertes par le workflow ne déclenchent pas la CI.
- [ ] Lancer le workflow une fois à la main (Actions > Weekly pipeline > Run workflow).
- [ ] Sur un dépôt public, GitHub désactive le workflow planifié après 60 jours sans activité : le réactiver dans l'onglet Actions.

## Réglages

Dans `data/config.yaml` :

- `review.maxReviewsPerRun` : nombre maximal de revues complètes par passage ;
- `review.maxMinutes` : budget de temps du passage entier, compté depuis son démarrage (140 minutes). Une fois atteint, le tri et les revues s'arrêtent et le reste est reporté à la semaine suivante ;
- `filter` : `allowedLicenses`, `minStars` (50), `maxDaysSinceLastCommit` (180) ;
- `collection` : `minSkills` et `minKitSkills` (3).

Choisir `maxReviewsPerRun` et `maxMinutes` à partir de la mesure du mode d'essai : coût par skill relu et durée totale (`time`). Diviser le budget de dépense par le coût par skill pour obtenir le plafond de revues. Vérifier que la durée des étapes avant les revues, plus le temps par revue multiplié par ce plafond, reste sous `maxMinutes` ; sinon, baisser le plafond ou accepter le report. L'étape du pipeline s'arrête à 170 minutes (le job, à 180 minutes).

## Données versionnées

Seuls les fichiers coûteux à refaire sont dans git : `data/curation.yaml`, `data/cache/reviews/`, `data/cache/triage.json`, `data/cache/kits.sha256` et `catalog.json`. Le site est construit à partir de ce fichier. `candidates.json`, `repos.json` et `skills.json` sont reconstruits depuis GitHub à chaque passage (plusieurs dizaines de Mo) et restent hors de git. Un passage complet relit donc tous les `SKILL.md`, ce qui allonge sa durée.

## Après un échec

Un échec ne produit aucune pull request. Le résumé et les statistiques du passage sont dans le journal du run. Le cache (`data/cache/`) et `pipeline-run.json` sont conservés 14 jours comme artefact nommé `reviews-<run id>`.

Pour récupérer les revues déjà payées :

1. Télécharger l'artefact depuis la page du run (Actions > le run en échec > Artifacts).
2. Créer une nouvelle branche depuis `main`.
3. Si `data/kits.yaml` n'a pas changé depuis le passage en échec, copier de l'artefact vers `data/cache/` le dossier `reviews/`, `triage.json` et `kits.sha256`. Sinon, ne rien copier, abandonner la branche et relancer simplement le workflow : le prochain passage repart de zéro.
4. Si des fichiers ont été copiés : committer, pousser et ouvrir une pull request.
5. Fusionner, puis relancer le workflow : les revues récupérées ne sont pas refaites.

## Coûts

Le modèle est `claude-haiku-5-5`, défini dans `data/config.yaml`. Aux tarifs d'environ 0,10 USD par million de jetons en entrée et 0,50 USD par million en sortie, une semaine typique coûte environ 1 à 2 USD et le pire cas environ 9 USD.

Ce sont des estimations. Les confirmer avec le mode d'essai, qui affiche les jetons par skill relu.

## Le site

Le site est un projet Astro statique dans `site/`. Il lit `catalog.json` et ne fait aucun appel réseau pendant la construction.

- `npm run site:dev` : sert le site en local sur http://localhost:4321.
- `npm run site:build` : construit le site dans `site/dist/`.
- `npm run site:verify` : vérifie le site construit (pages attendues, contenu des kits, index de recherche). À lancer après `site:build`.

Le déploiement viendra au sprint 3.
