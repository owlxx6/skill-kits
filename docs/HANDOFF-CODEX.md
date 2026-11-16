Tu travailles sur owlxx6/skill-kits avec un autre agent. Lis docs/LAUNCH-PLAN.md avant toute modification. Le public comprend développeurs et utilisateurs moins techniques. Chaque agent utilise sa propre branche et son propre dossier de travail. Ne modifie pas le dossier de travail de l'autre agent. Ne réinitialise pas les modifications existantes.

La direction retenue pour l’accueil est maintenant Build Room, blanc/noir/rouge et bouton de thème icon-only. La référence est docs/design-previews/build-room.html. Les anciens Switchyard/Career Desk restent des alternatives historiques. Les pages de détail Astro sont conservées pour le moment. Le rendu intégré doit encore être validé visuellement sur desktop/mobile.

Main est la branche de production prévue. Travaille sur la branche indiquée, avec commits ciblés et PR relue. Aucun merge dans main sans validation du propriétaire. Pour le design, montre le résultat desktop/mobile avant de pousser l'implémentation. Les trois branches initiales ont été vérifiées sur GitHub au commit 38b3c4f. Récupère aussi le dernier plan depuis planning/launch-parallel avant de commencer.

Signale les modifications de contrats de données à l'autre agent avant qu'il développe dessus. Ne touche pas simultanément à package.json, package-lock.json, catalog.json ou .github sans répartition explicite. Utilise les commandes du README, npm.cmd dans PowerShell si nécessaire. Le pipeline complet peut consommer une API payante; ce prompt n'autorise pas de nouvelles dépenses.

Le propriétaire a confirmé B pour les licences. Il reste à décider catalogue public d'abord ou comptes dès le premier lancement. Clarifie ces décisions quand elles bloquent ta tâche. Ne transforme pas une préférence d'implémentation en demande d'approbation.

TA BRANCHE: codex/design-switchyard
TA PREMIÈRE MISSION: intégrer dans Astro le design retenu. Build Room est la page principale; les pages kits Astro actuelles restent la base des détails. Ajouter une liste de composants utile, un ordre d'installation explicite et une commande d'installation mise en valeur, avec liens réels du catalogue.
PÉRIMÈTRE: site/src et éléments frontend nécessaires. Claude Code possède les schémas du pipeline. Commence avec le format catalogue existant et coordonne toute évolution.
Pas de badges décoratifs, bande de chiffres, cartes uniformes ou suggestion chips. Conserve l'interaction du réseau et du dossier si elle aide la navigation. N'affiche aucune certification non prouvée, aucun kit prêt sans approbation ni commande inventée.
Respecte les contrôles accessibles, la navigation clavier, le mobile, le reduced motion et le thème persistant. 21st gratuit pour recherche d'inspiration, au maximum deux composants tirés par jour, réécrits pour Astro. Décris l'outil réellement disponible sans prétendre qu'un login navigateur suffit pour le MCP.
LIVRABLES: pages Astro intégrées, contrôle visuel desktop/mobile, typecheck, tests existants, build et site:verify. Présente au propriétaire avant tout push de l'implémentation design. Relis la PR licences de Claude; il relira la tienne.

CRITÈRE CONFIRMÉ: priorité à la fiabilité et à la valeur démontrée pour une tâche. Faible usage, peu de stars ou de forks ne disqualifient pas un skill. Lire la section Selection policy du plan; conserver les preuves de licence, de revue et de test, ainsi que la validation finale du propriétaire. Documenter la révision du seuil minStars et du classement pour un suivi coordonné.
