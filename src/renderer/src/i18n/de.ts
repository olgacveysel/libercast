import type { TranslationKey } from './en'

/**
 * Deutsch.
 *
 * Typed against the English key list, so a string added there and forgotten
 * here will not compile.
 *
 * German compounds run long, and several of these sit in narrow buttons and a
 * fixed-width sidebar — so the labels are kept short deliberately ("Mehrfach"
 * rather than "Mehrfachansicht") where the surrounding context already makes
 * the meaning clear.
 */
export const de: Record<TranslationKey, string> = {
  'nav.home': 'Start',
  'nav.live': 'Live-TV',
  'nav.guide': 'Programm',
  'nav.multiview': 'Mehrfach',
  'nav.movies': 'Filme',
  'nav.series': 'Serien',
  'nav.favorites': 'Favoriten',
  'nav.library': 'Bibliothek',
  'nav.settings': 'Einstellungen',
  'nav.sources': 'Quellen',
  'nav.allSources': 'Alle Quellen',
  'nav.allSourcesBody': 'Alle Quellen als eine Liste, Doppelte zusammengefasst',
  'nav.noSources': 'Noch keine Quellen.',
  'nav.addSource': 'Quelle hinzufügen',
  'nav.search': 'Suchen',
  'nav.searchEverything': 'Alles durchsuchen',
  'nav.neverSynced': 'Nie synchronisiert',

  'common.close': 'Schließen',
  'common.cancel': 'Abbrechen',
  'common.save': 'Speichern',
  'common.apply': 'Übernehmen',
  'common.remove': 'Entfernen',
  'common.refresh': 'Aktualisieren',
  'common.retry': 'Erneut versuchen',
  'common.loading': 'Wird geladen…',
  'common.sync': 'Sync',
  'common.syncing': 'Synchronisiert…',
  'common.play': 'Wiedergabe',
  'common.pause': 'Pause',
  'common.edit': 'Bearbeiten…',
  'common.done': 'Fertig',
  'common.channels': 'Sender',
  'common.never': 'Nie',
  'common.on': 'An',
  'common.off': 'Aus',

  'home.title': 'Start',
  'home.continueWatching': 'Weiterschauen',
  'home.favorites': 'Favoriten',
  'home.jumpBackIn': 'Zuletzt gesehen',
  'home.seeAll': 'Alle ansehen',
  'home.minutesLeft': 'Noch {minutes} Min.',
  'home.removeFromContinue': 'Aus „Weiterschauen“ entfernen',
  'home.emptyTitle': 'Noch nichts gesehen',
  'home.emptyBody': 'Öffne Live-TV, um einen Sender zu wählen, oder suche nach einem Namen.',
  'home.browseChannels': 'Sender durchsehen',
  'home.welcomeTitle': 'Willkommen bei {app}',
  'home.letsGetWatching': 'Auf geht’s',
  'home.welcomeBody':
    'Dieser Player spielt das Abo ab, das du bereits hast. Er liefert weder Sender noch Listen oder Konten — die bringst du mit.',
  'home.step1': 'Quelle hinzufügen',
  'home.step1Body': 'Xtream-Codes-Zugang oder eine M3U-Liste als Adresse oder Datei.',
  'home.step2': 'Synchronisieren',
  'home.step2Body': 'Sender, Filme und Serien werden einmal geladen und lokal gespeichert.',
  'home.step3': 'Programm laden',
  'home.step3Body':
    'Optional, zeigt aber, was gerade läuft, und ermöglicht geplante Aufnahmen.',

  'live.title': 'Live-TV',
  'live.favoritesTitle': 'Favoriten',
  'live.searchChannels': 'Sender suchen…',
  'live.categories': 'Kategorien',
  'live.allChannels': 'Alle Sender',
  'live.sortName': 'A–Z',
  'live.sortNumber': 'Nr.',
  'live.sortRecent': 'Zuletzt',
  'live.hidden': 'Ausgeblendet',
  'live.showHidden': 'Ausgeblendete Sender anzeigen',
  'live.hideHidden': 'Ausgeblendete Sender verbergen',
  'live.hideChannel': 'Diesen Sender aus der Liste ausblenden',
  'live.showChannel': 'Diesen Sender wieder anzeigen',
  'live.addFavorite': 'Zu Favoriten hinzufügen',
  'live.removeFavorite': 'Aus Favoriten entfernen',
  'live.noChannelNumber': 'Kein Sender {number}',
  'live.syncNow': 'Jetzt synchronisieren',
  'live.hideLists': 'Kategorien und Senderliste ausblenden',
  'live.showLists': 'Kategorien und Senderliste einblenden',

  'sleep.label': 'Sleeptimer',
  'sleep.title': 'Wiedergabe nach einer Weile beenden',
  'sleep.minutes': '{minutes} Min.',
  'sleep.offHint': 'Läuft weiter, bis du sie beendest.',

  'health.scan': 'Favoriten prüfen',
  'health.title': 'Favoriten werden geprüft',
  'health.body':
    'Jeder wird nacheinander geöffnet, einzeln, damit die Prüfung nicht mit dem eigenen Verbindungslimit kollidiert. Schließen beendet sie.',
  'health.checking': 'Prüfe {done} von {total} — {name}',
  'health.allWell': 'Alle {count} Favoriten haben geantwortet.',
  'health.summary': '{failed} von {total} haben nicht geantwortet.',
  'health.noReason': 'Kein Grund angegeben.',
  'health.dead': 'keine Antwort',
  'health.deadTitle': 'Dieser Sender hat bei der letzten Prüfung nicht geantwortet.',

  'player.fullscreen': 'Vollbild',
  'catchup.replay': 'Aus dem Archiv des Anbieters erneut ansehen',
  'catchup.replayOne': '{title} erneut ansehen',
  'catchup.replaying': '{title} wird erneut abgespielt',
  'catchup.backToLive': 'Zurück zu Live',
  'player.switchedSource': '{from} lief nicht — zu {to} gewechselt',
  'player.audio': 'Ton',
  'player.subtitles': 'Untertitel',
  'player.speed': 'Tempo',
  'player.picture': 'Bild',
  'player.zoom': 'Zoom',
  'player.reset': 'Zurücksetzen',
  'player.mute': 'Stumm',
  'player.unmute': 'Ton an',
  'player.volume': 'Lautstärke',
  'player.record': 'Aufnehmen',
  'player.stopRecording': 'Aufnahme beenden',
  'player.previousChannel': 'Vorheriger Sender',
  'player.nextChannel': 'Nächster Sender',
  'player.previousEpisode': 'Vorherige Folge',
  'player.nextEpisode': 'Nächste Folge',
  'player.back30': '30 Sekunden zurück',
  'player.forward30': '30 Sekunden vor',
  'player.seek': 'Spulen',
  'player.nextUp': 'Nächste Folge',
  'player.playNow': 'Jetzt abspielen',
  'player.dismiss': 'Ausblenden',
  'player.noGuideData': 'Keine Programmdaten für diesen Sender',
  'player.whatElseIsOn': 'Was sonst auf diesem Sender läuft',
  'player.live': 'LIVE',
  'player.openSubtitleFile': 'Untertiteldatei öffnen…',
  'player.subtitleOffset': 'Versatz',

  'fit.fit': 'Einpassen',
  'fit.fill': 'Füllen',
  'fit.stretch': 'Strecken',
  'fit.16by9': '16:9',
  'fit.4by3': '4:3',
  'fit.fitHint': 'Zeigt das ganze Bild. Verzerrt nie.',
  'fit.fillHint': 'Beschneidet, bis das Fenster gefüllt ist. Entfernt eingebrannte schwarze Balken.',
  'fit.stretchHint': 'Füllt das Fenster genau aus. Verzerrt das Bild.',
  'fit.16by9Hint': 'Erzwingt Breitbild, wenn ein Stream das falsche Format meldet.',
  'fit.4by3Hint': 'Erzwingt das alte Fernsehformat.',

  'guide.title': 'Programm',
  'guide.refreshGuide': 'Programm laden',
  'guide.matching': 'Programmzuordnung',
  'guide.record': 'Aufnehmen',
  'guide.remindMe': 'Erinnern',
  'guide.reminderSet': 'Erinnerung gesetzt',
  'guide.noDescription': 'Keine Beschreibung vorhanden.',
  'guide.scheduleNote':
    'Geplant. Erscheint in der Bibliothek, mit 2 Minuten Vorlauf und 5 Minuten Nachlauf.',
  'guide.reminderNote':
    'Du wirst 5 Minuten vor Beginn benachrichtigt. Ein Klick darauf schaltet zum Sender.',
  'guide.reminderCancelled': 'Erinnerung abgebrochen.',
  'guide.alreadyStarted': 'Diese Sendung hat bereits begonnen',
  'guide.alreadyFinished': 'Diese Sendung ist bereits vorbei',
  'guide.needsFfmpeg': 'Aufnahme benötigt ffmpeg',

  'library.title': 'Bibliothek',
  'library.recordings': 'Aufnahmen',
  'library.downloads': 'Downloads',
  'library.reminders': 'Erinnerungen',
  'library.nothingRecorded': 'Noch nichts aufgenommen',
  'library.nothingRecordedBody':
    'Drücke Aufnehmen, während ein Sender läuft, oder plane eine Sendung im Programm.',
  'library.noReminders': 'Keine Erinnerungen',
  'library.noRemindersBody':
    'Öffne das Programm, wähle eine Sendung und drücke Erinnern. Du wirst vor Beginn benachrichtigt; ein Klick schaltet zum Sender.',
  'library.showInFolder': 'Im Ordner anzeigen',
  'library.stop': 'Beenden',
  'library.onNow': 'Läuft jetzt',
  'library.notified': 'Benachrichtigt',

  'settings.title': 'Einstellungen',
  'settings.sources': 'Quellen',
  'settings.appearance': 'Darstellung',
  'settings.language': 'Sprache',
  'settings.languageBody': 'Die Sprache der Oberfläche. Wirkt sofort.',
  'settings.theme': 'Design',
  'settings.themeBody': 'Dunkel ist die Voreinstellung, darauf ist die Gestaltung abgestimmt.',
  'settings.themeDark': 'Dunkel',
  'settings.themeLight': 'Hell',
  'settings.themeSystem': 'System',
  'settings.connections': 'Verbindungen zum Anbieter',
  'settings.autoRefresh': 'Automatisch aktualisieren',
  'settings.keyboard': 'Tastatur',
  'settings.folders': 'Ordner',
  'settings.recordingsFolder': 'Aufnahmen',
  'settings.downloadsFolder': 'Downloads',
  'settings.notSet': 'Nicht festgelegt',
  'settings.choose': 'Wählen…',
  'settings.about': 'Über',
  'settings.version': 'Version {version}',
  'settings.parental': 'Kindersicherung',
  'settings.backup': 'Sicherung',
  'settings.account': 'Konto',
  'settings.checkAccount': 'Konto prüfen',
  'settings.checking': 'Wird geprüft…',
  'settings.connectionsLabel': 'Verbindungen',
  'settings.status': 'Status',
  'settings.expires': 'Läuft ab',
  'settings.username': 'Benutzername',
  'settings.subtitles': 'Untertitel',
  'settings.subtitlesBody':
    'Wie der Untertiteltext dargestellt wird. Wo eine Zeile im Bild steht, gibt der Untertitel selbst vor — das lässt sich hier nicht verschieben.',
  'settings.subtitleSample': 'Franz jagt im komplett verwahrlosten Taxi quer durch Bayern',
  'settings.subtitleSize': 'Größe',
  'settings.subtitleSizeBody': 'Relativ zum Bild, bleibt im Vollbild also gleich groß.',
  'settings.subtitleSmall': 'Klein',
  'settings.subtitleDefault': 'Standard',
  'settings.subtitleLarge': 'Groß',
  'settings.subtitleLarger': 'Größer',
  'settings.subtitleLargest': 'Am größten',
  'settings.subtitleColor': 'Textfarbe',
  'settings.subtitleColorBody': 'Gelb ist über hellem Bild angenehmer zu lesen.',
  'settings.subtitleBackground': 'Hintergrund',
  'settings.subtitleBackgroundBody': 'Der Kasten hinter dem Text.',
  'settings.subtitleOpacity': 'Deckkraft des Hintergrunds',
  'settings.subtitleOpacityBody': 'Ohne Kasten bitte mit Kontur, damit der Text lesbar bleibt.',
  'settings.opacity.none': 'Keiner',
  'settings.opacity.light': 'Leicht',
  'settings.opacity.default': 'Standard',
  'settings.opacity.solid': 'Deckend',
  'settings.subtitleEdge': 'Kante',
  'settings.subtitleEdgeBody': 'Was die Buchstaben vom Bild dahinter abgrenzt.',
  'settings.edge.none': 'Keine',
  'settings.edge.shadow': 'Schatten',
  'settings.edge.outline': 'Kontur',
  'settings.subtitleFont': 'Schriftart',
  'settings.subtitleFontBody': 'Serifenlos liest sich aus der Entfernung am besten.',
  'settings.font.sans': 'Serifenlos',
  'settings.font.serif': 'Serif',
  'settings.font.mono': 'Monospace',
  'settings.subtitleReset': 'Zurück zum Standard',
  'settings.subtitleResetBody': 'Weißer Text auf dunklem Kasten, in Standardgröße.',
  'nav.lastSynced': 'Zuletzt synchronisiert {when}',
  'nav.collapseSidebar': 'Seitenleiste einklappen',
  'nav.expandSidebar': 'Seitenleiste ausklappen',

  'mv.clearAll': 'Alle leeren',
  'mv.addChannel': 'Sender hinzufügen',
  'mv.changeChannel': 'Sender wechseln',
  'mv.watchFull': 'Im Vollbild ansehen',
  'mv.listen': 'Ton auf dieses Feld legen (Taste {key})',
  'mv.hasAudio': 'Dieses Feld hat den Ton',
  'mv.enlarge': 'Dieses Feld vergrößern (oder doppelklicken)',
  'mv.shrink': 'Zurück zum gleichmäßigen Raster',
  'mv.detach': 'In eigenem Fenster öffnen (für einen zweiten Monitor)',
  'mv.detached': 'Läuft in eigenem Fenster',
  'mv.returnToGrid': 'Zurück ins Raster',
  'mv.noSource': 'Keine Quelle ausgewählt',
  'mv.noSourceBody': 'Die Mehrfachansicht braucht eine Quelle mit Sendern.',
  'mv.connectionWarning':
    'Jedes Feld öffnet eine eigene Verbindung zum Anbieter. Die meisten Konten erlauben nur eine oder zwei gleichzeitig — Felder darüber hinaus starten nicht. Die Anzahl steht in den Einstellungen unter Konto.',
  'settings.autoUpdateAsk': 'Automatisch bei GitHub nach neuen Versionen sehen? LiberCast fragt einmal täglich nach der neuesten Versionsnummer und sendet nichts über dich.',
  'settings.autoUpdateYes': 'Ja, nachsehen',
  'settings.autoUpdateNo': 'Nein, ich sehe selbst nach',
  'settings.autoUpdate': 'Automatisch nach Updates sehen',
  'settings.autoUpdateBody': 'Fragt einmal täglich bei GitHub nach der neuesten Versionsnummer. Nichts über dich oder deine Quellen wird gesendet. Aus, bis du es einschaltest.',
  'settings.updates': 'Aktualisierungen',
  'settings.updatesBody': 'Wird nur auf Wunsch geprüft. Von selbst wird nichts gesendet.',
  'settings.checkUpdates': 'Jetzt prüfen',
  'settings.updateFound': 'Version {version} ist verfügbar.',
  'settings.updateOpen': 'Release-Seite öffnen',
  'settings.updateNone': 'Du hast die neueste Version.',
  'settings.updateFailed': 'Prüfung nicht möglich: {reason}',
  'settings.logs': 'Protokolldatei',
  'settings.logsBody':
    'Was die Anwendung aufgezeichnet hat, ohne Passwörter. Einer Fehlermeldung beilegen.',
  'settings.showLogs': 'Protokolldatei anzeigen',
  'settings.logsNone': 'Es wurde noch nichts protokolliert.',

  /* ---------------- screens moved onto the dictionary ---------------- */
  /* Settings */
  'settings.frugal': 'So wenige Verbindungen wie möglich belegen',
  'settings.frugalBody':
    'Einen Sender zu starten kostet normalerweise zwei Verbindungen kurz nacheinander — eine, um den Stream zu erkennen, eine, um ihn abzuspielen. Erlaubt dein Konto nur eine, wird die zweite abgewiesen und der Sender öffnet nur manchmal. Mit dieser Einstellung wird ein noch nie gespielter Sender stattdessen auf Verdacht gestartet.',
  'settings.frugalNote':
    'So oder so wird gemerkt, was ein Stream ist. Beim zweiten Mal kostet alles nur noch eine Verbindung. Die Menüs für Ton und Untertitel bleiben bei einem Live-Sender leer, bis er einmal lief.',
  'settings.failover': 'Bei Ausfall von einer anderen Quelle spielen',
  'settings.failoverBody':
    'Mit mehr als einer Quelle wird ein Live-Sender, der nicht startet — oder mittendrin abbricht — bei deinen anderen Anbietern gesucht und von dort gespielt. Sendernummern werden beachtet, ein Sender mit der 2 landet also nie bei der 4. Ein kurzer Hinweis nennt die Quelle, die übernommen hat. Aus, wenn nur die gewählte Quelle Verbindungen kosten soll.',
  'settings.refreshEvery': 'Quellen aktualisieren alle',
  'settings.refreshEveryBody':
    'Standardmäßig aus. Eine Aktualisierung spricht mit deinem Anbieter und wird übersprungen, solange etwas läuft — sie kann einem Stream also nie die Verbindung wegnehmen.',
  'settings.everyWeek': 'Woche',
  'settings.everyHours': '{hours} Stunden',
  'settings.refreshEpg': 'Programm einschließen',
  'settings.refreshEpgBody': 'Lädt das EPG im selben Durchgang.',
  'settings.lastRefresh': 'Letzte automatische Aktualisierung',
  'settings.refreshing': 'Wird aktualisiert…',
  'settings.refreshNow': 'Jetzt aktualisieren',
  'settings.uiScale': 'Oberflächengröße',
  'settings.uiScaleBody': 'Skaliert alles. Nützlich auf einem großen Bildschirm vom Sofa aus.',
  'settings.accent': 'Akzentfarbe',
  'settings.accentBody': 'Für Auswahl, Fokusrahmen und Fortschritt.',
  'settings.accentSwatch': 'Akzent {color}',
  'settings.playback': 'Wiedergabe',
  'settings.hwAccel': 'Hardwarebeschleunigung',
  'settings.hwAccelBody':
    'Dekodiert Video über die GPU. Nur abschalten, wenn das Bild reißt oder abstürzt.',
  'settings.streamInfo': 'Streaminfos anzeigen',
  'settings.streamInfoBody':
    'Auflösung, gemessene Bildrate, verlorene Bilder und Codec, über dem Bild. Im Vollbild ausgeblendet. Während der Wiedergabe mit I umschalten.',
  'settings.resumeLast': 'Letzten Sender beim Start fortsetzen',
  'settings.resumeLastBody': 'Öffnet beim Start den Sender, den du zuletzt gesehen hast.',
  'settings.languages': 'Sprachen',
  'settings.preferredAudio': 'Bevorzugter Ton',
  'settings.preferredAudioBody':
    'Wird automatisch gewählt, wenn ein Titel mehrere Sprachen bietet. Ohne Ziehen: klicken schaltet um, die Reihenfolge folgt der Liste unten.',
  'settings.preferredSubtitles': 'Bevorzugte Untertitel',
  'settings.preferredSubtitlesBody':
    'Werden automatisch eingeschaltet, wenn eine passende Spur existiert. Leer lassen, damit Untertitel aus bleiben, bis du sie wählst.',
  'settings.mediaEngine': 'Medien-Engine',
  'settings.ffmpegWorking': 'Funktioniert — es wird die Kopie aus {source} verwendet.',
  'settings.ffmpegMissing':
    'Nicht gefunden. Ohne ffmpeg sind MPEG-TS-Sender und Aufnahmen nicht verfügbar.',
  'settings.missing': 'Fehlt',
  'settings.ffmpegFolder': 'Eigener ffmpeg-Ordner',
  'settings.ffmpegFolderBody':
    'Nicht gesetzt. Zeigt auf einen Ordner mit ffmpeg und ffprobe, falls die mitgelieferte Kopie versagt.',
  'settings.clear': 'Leeren',
  'settings.concurrentDownloads': 'Gleichzeitige Downloads',
  'settings.concurrentDownloadsBody':
    'Jeder Download belegt eine Verbindung zu deinem Anbieter. Die meisten Konten erlauben sehr wenige, mehr als einer kann die Wiedergabe lahmlegen.',
  'settings.xmltvUrl': 'XMLTV-URL',
  'settings.xmltvUrlHint': 'Leer lassen für das Programm des Anbieters',
  'settings.xmltvBody': 'Reines XML oder gzip. Überschreibt das Anbieterprogramm, wenn gesetzt.',
  'settings.epgOffset': 'Zeitversatz (Minuten)',
  'settings.epgOffsetBody':
    'Verschiebt jede Sendung. −60 oder +60 nehmen, wenn das Programm genau eine Stunde danebenliegt.',
  'settings.userAgent': 'User-Agent',
  'settings.userAgentBody':
    'Wird bei jeder Anfrage an diesen Anbieter mitgesendet. Leer lassen, außer Streams scheitern, während dieselben Links in einem anderen Player funktionieren.',
  'settings.referrer': 'Referrer',
  'settings.referrerHint': 'Nur nötig, wenn dein Anbieter danach fragt',
  'settings.refreshNeverRan': 'Noch nicht gelaufen.',
  'settings.refreshFailed': '{when} — fehlgeschlagen: {error}',
  'settings.refreshNoChange': 'nichts geändert',
  'settings.refreshChanged': '{added} neu, {removed} entfernt',
  'settings.refreshProgrammes': '{count} Sendungen',
  'settings.refreshGuideFailed': 'Programm fehlgeschlagen: {error}',
  'settings.refreshSourcesFailed': '{count} Quelle(n) fehlgeschlagen',

  /* Parental controls */
  'parental.setPin': 'PIN festlegen',
  'parental.setPinBody':
    '4 bis 8 Ziffern. Gesperrte Kategorien, passende Titel und Inhalte für Erwachsene sind auf jedem Bildschirm verborgen — auch in der Suche und unter Weiterschauen — bis sie eingegeben wird.',
  'parental.newPin': 'Neue PIN',
  'parental.pinSet': 'PIN festgelegt.',
  'parental.turnOn': 'Einschalten',
  'parental.locked': 'Gesperrt',
  'parental.lockedBody':
    'Gib deine PIN ein, um diese Einstellungen zu ändern oder verborgene Inhalte zu zeigen.',
  'parental.pin': 'PIN',
  'parental.unlock': 'Entsperren',
  'parental.unlockedTimed': 'Entsperrt. Sperrt nach {minutes} Minuten ohne Aktivität wieder.',
  'parental.unlockedUntilClose': 'Entsperrt. Sperrt wieder, wenn die App geschlossen wird.',
  'parental.hideAdult': 'Inhalte für Erwachsene verbergen',
  'parental.hideAdultBody':
    'Gilt für alles, was der Anbieter oder die Listenauswertung so markiert hat.',
  'parental.autoLock': 'Automatisch sperren nach',
  'parental.autoLockBody':
    'Minuten ohne Aktivität, bis die PIN wieder nötig ist. 0 bleibt entsperrt.',
  'parental.minutes': '{value} Min.',
  'parental.keywords': 'Gesperrte Wörter',
  'parental.keywordsBody': 'Titel mit einem dieser Wörter sind im gesperrten Zustand verborgen.',
  'parental.addWord': 'Wort hinzufügen',
  'parental.add': 'Hinzufügen',
  'parental.lockedCategories': 'Gesperrte Kategorien',
  'parental.noCategories': 'Synchronisiere eine Quelle, um ihre Kategorien zu sehen.',
  'parental.lockedCount': '{locked} von {total} gesperrt.',
  'parental.changePin': 'PIN ändern oder entfernen',
  'parental.changePinBody': 'Beim Entfernen werden alle verborgenen Inhalte wieder sichtbar.',
  'parental.currentPin': 'Aktuell',
  'parental.newPinShort': 'Neu',
  'parental.pinChanged': 'PIN geändert.',
  'parental.change': 'Ändern',
  'parental.turnedOff': 'Jugendschutz ausgeschaltet.',
  'parental.turnOff': 'Ausschalten',
  'parental.lockNow': 'Jetzt sperren',
  'parental.lockNowBody': 'Verbirgt die gesperrten Inhalte sofort, ohne auf den Timer zu warten.',
  'parental.lockedNote': 'Gesperrt.',
  'parental.lock': 'Sperren',

  /* Add source dialog */
  'source.add': 'Quelle hinzufügen',
  'source.addBody': 'LiberCast spielt dein eigenes Abo ab. Sender liefert es nicht.',
  'source.m3u': 'M3U-Liste',
  'source.name': 'Name',
  'source.nameProvider': 'Mein Anbieter',
  'source.namePlaylist': 'Meine Liste',
  'source.serverUrl': 'Server-URL',
  'source.serverUrlHint':
    'Füge den Host ein, den dein Anbieter genannt hat. Ein angehängter Pfad wird automatisch entfernt.',
  'source.password': 'Passwort',
  'source.passwordHint':
    'Das Passwort wird mit Windows DPAPI verschlüsselt und verlässt diesen Rechner nie.',
  'source.playlistUrl': 'Listen-URL',
  'source.orLocalFile': '…oder eine lokale Datei',
  'source.browse': 'Durchsuchen…',
  'source.noFile': 'Keine Datei gewählt',
  'source.connectedAs':
    'Verbunden als {username} — Status {status}, {active}/{max} Verbindungen in Benutzung',
  'source.expiresOn': ', läuft ab am {date}.',
  'source.noExpiry': ', ohne Ablauf.',
  'source.playlistOk': 'Liste erreichbar und erfolgreich gelesen.',
  'source.test': 'Verbindung testen',
  'source.addButton': 'Quelle hinzufügen',
  'parental.wrongPin': 'Diese PIN stimmt nicht.',

  /* Guide */
  'guide.now': 'Jetzt',
  'guide.noSourceBody': 'Das Programm braucht eine Quelle mit EPG-Daten.',
  'guide.noProgrammes':
    'Die EPG-Quelle lieferte keine Sendungen. Prüfe die XMLTV-URL in den Einstellungen.',
  'guide.noneMatched':
    '{count} Sendungen geladen, aber keine passte zu einem Sender — die Programm-IDs decken sich nicht mit dieser Liste.',
  'guide.matchedSummary': '{count} Sender zugeordnet · aktualisiert {when}',
  'guide.fixMatching': 'Zuordnung korrigieren',
  'guide.refreshEpg': 'EPG aktualisieren',
  'guide.downloading': 'Wird geladen…',
  'guide.noDataYet':
    'Noch keine Programmdaten. Mit {action} lädst du sie von deinem Anbieter.',
  'guide.downloadedNoneAttached':
    '{count} Sendungen wurden geladen, aber keine hängt an einem Sender — die Programm-IDs decken sich nicht mit dieser Liste.',
  'guide.watchChannel': '{name} ansehen',
  'guide.loading': 'Programm wird geladen…',
  'guide.noData': 'Keine Programmdaten',
  'guide.previousPage': '{count} zurück',
  'guide.nextPage': '{count} weiter',
  'guide.rowsRange': 'Zeilen {from}–{to}',
  'guide.cancelReminder': 'Diese Erinnerung abbrechen',
  'guide.reminderHint': '5 Minuten vor Beginn benachrichtigt werden',

  /* Guide matching */
  'guide.matchingBody':
    'Ein Sender zeigt nur dann Programmdaten, wenn seine ID im XMLTV-Feed vorkommt. {matched} von {total} sind zugeordnet. Der Rest lässt sich über den Namen zuordnen oder von Hand wählen.',
  'guide.needsFixing': 'Zu korrigieren ({count})',
  'guide.allCount': 'Alle ({count})',
  'guide.matchByName': 'Über Namen zuordnen',
  'guide.matchedOne': '1 Sender über den Namen zugeordnet.',
  'guide.matchedMany': '{count} Sender über den Namen zugeordnet.',
  'guide.matchedAmbiguous': '{count} waren zu uneindeutig und müssen von Hand gewählt werden.',
  'guide.matchedNone':
    'Über den Namen ließ sich nichts Neues zuordnen. Wähle den richtigen Programmsender unten.',
  'guide.allMatched': 'Jeder Sender ist dem Programm zugeordnet.',
  'guide.noSearchMatch': 'Kein Sender passt zu dieser Suche.',
  'guide.matched': 'zugeordnet',
  'guide.overrideAuto': 'automatisch',
  'guide.overrideManual': 'von Hand',
  'guide.idNotInGuide': 'ID „{id}“ steht nicht im Programm',
  'guide.noProviderId': 'der Anbieter gab diesem Sender keine Programm-ID',
  'guide.resetToProviderId': 'Zurück zur ID des Anbieters',
  'guide.change': 'Ändern',
  'guide.channelFor': 'Programmsender für {name}',
  'guide.rankedBody':
    'Sortiert danach, wie gut die Namen passen. Tippe, um den Feed nach etwas anderem zu durchsuchen.',
  'guide.searching': 'Wird gesucht…',
  'guide.noSuggestions':
    'Nichts im Programm ähnelt dem. Der Feed deckt diesen Sender vielleicht gar nicht ab.',

  /* Channel schedule */
  'schedule.body':
    'Was heute läuft. Die Zeiten stammen aus dem Programm und sind so genau wie dieses.',
  'schedule.nothingForChannel':
    'Das Programm hat nichts für diesen Sender. Die Zuordnung im Programm-Bildschirm kann ihn auf den richtigen Feed zeigen lassen.',
  'schedule.noGuideId':
    'Der Anbieter gab diesem Sender keine Programm-ID, es lässt sich also nichts zuordnen. Im Programm-Bildschirm kannst du eine von Hand setzen.',
  'schedule.remindBefore': 'Vor Beginn erinnern',
  'schedule.remindAbout': 'An {title} erinnern',
  'schedule.reminded': 'Du wirst vor Beginn von {title} erinnert.',
  'schedule.reminderFailed': 'Diese Erinnerung ließ sich nicht setzen.',
  'schedule.recordThis': 'Diese Sendung aufnehmen',
  'schedule.recordTitle': '{title} aufnehmen',
  'schedule.recordScheduled': '{title} wird aufgenommen und erscheint in der Bibliothek.',
  'schedule.recordFailed': 'Diese Aufnahme ließ sich nicht planen.',

  /* Live TV */
  'live.sourcesTitle': 'Bei {count} deiner Quellen vorhanden — fällt eine aus, greift die andere',
  'live.noSourceBody':
    'Füge einen Xtream-Codes-Zugang oder eine M3U-Liste hinzu, um Sender zu durchsuchen.',
  'live.channelsHead': 'Sender',
  'live.showingCount': '({count} angezeigt)',
  'live.noFavorites': 'Noch keine Favoriten',
  'live.noFavoritesBody': 'Markiere einen Sender mit einem Stern, um ihn hier zu behalten.',
  'live.noChannels': 'Keine Sender',
  'live.noMatches': 'Nichts passt zu diesem Filter.',
  'live.notSynced': 'Diese Quelle wurde noch nicht synchronisiert.',

  /* Common — status words shared by the Downloads and Library lists */
  'common.ready': 'Fertig',
  'common.failed': 'Fehlgeschlagen',
  'common.cancelled': 'Abgebrochen',

  /* VOD browser */
  'vod.addSourceMovies': 'Füge eine Quelle hinzu, um Filme zu durchsuchen.',
  'vod.addSourceSeries': 'Füge eine Quelle hinzu, um Serien zu durchsuchen.',
  'vod.searchMovies': 'Filme suchen…',
  'vod.searchSeries': 'Serien suchen…',
  'vod.showing': '({count} angezeigt)',
  'vod.allMovies': 'Alle Filme',
  'vod.allSeries': 'Alle Serien',
  'vod.noMovies': 'Keine Filme gefunden',
  'vod.noSeries': 'Keine Serien gefunden',
  'vod.noMatches':
    'Nichts passt zu diesem Filter, oder dieser Anbieter bietet keinen VOD-Katalog an.',
  'vod.notSynced': 'Diese Quelle wurde noch nicht synchronisiert.',

  /* VOD player */
  'vod.converting': 'ffmpeg wandelt diesen Stream gerade um',
  'vod.subtitleUnreadable':
    'Diese Datei ließ sich nicht lesen. Öffne sie stattdessen über das Untertitelmenü.',
  'vod.subtitleWrongType':
    'Das ist keine Untertiteldatei. Ziehe eine .srt-, .vtt- oder .ass-Datei hierher.',
  'vod.previousIs': 'Vorher: S{season}E{episode} {title}',
  'vod.nextIs': 'Danach: S{season}E{episode} {title}',
  'vod.firstEpisode': 'Das ist die erste Folge',
  'vod.lastEpisode': 'Das ist die letzte Folge',
  'vod.playHint': 'Abspielen (Leertaste)',
  'vod.pauseHint': 'Pause (Leertaste)',
  'vod.audioNote': 'Ein Tonwechsel startet den Stream ab dieser Stelle neu.',
  'vod.subtitleNote': 'Ein Untertitelwechsel startet den Stream ab dieser Stelle neu.',
  'vod.subtitlesBurnedIn':
    'Dieser Untertitel ist ein Bild, wird also ins Bild gezeichnet und das Video neu kodiert.',
  'vod.speedTitle': 'Abspielgeschwindigkeit: {speed} ([ und ])',
  'vod.fullscreenHint': 'Vollbild (F oder Doppelklick aufs Video)',
  'vod.leaveFullscreenHint': 'Vollbild verlassen (F oder Esc)',

  /* Downloads */
  'downloads.queued': 'In Warteschlange',
  'downloads.downloading': 'Wird geladen',
  'downloads.paused': 'Pausiert',
  'downloads.resume': 'Fortsetzen',
  'downloads.emptyTitle': 'Nichts heruntergeladen',
  'downloads.emptyBody':
    'Öffne einen Film oder eine Folge und wähle Download, um sie offline zu behalten.',
  'downloads.deleteFile': 'Die heruntergeladene Datei ebenfalls löschen?',
  'downloads.ofTotal': '{done} von {total}',
  'downloads.download': 'Download',
  'downloads.retry': 'Download erneut versuchen',
  'downloads.offlineHint': 'Für offline herunterladen',
  'downloads.downloadedSize': 'Geladen · {size}',
  'downloads.pausedPercent': 'Pausiert · {percent} %',
  'downloads.resumeDownload': 'Download fortsetzen',
  'downloads.pauseDownload': 'Download pausieren',
  'downloads.cancelDownload': 'Download abbrechen',

  /* Library */
  'library.scheduled': 'Geplant',
  'library.recording': 'Nimmt auf',
  'library.deleteFile': 'Die aufgenommene Datei ebenfalls löschen?',
  'library.needsFfmpegBody':
    'Es wurde kein funktionierendes ffmpeg gefunden, daher sind Aufnahme und Wiedergabe nicht möglich.',
  'library.openSettings': 'Einstellungen öffnen',
  'library.counts': '{ready} fertig · {scheduled} geplant',
  'library.alertsBefore': 'meldet sich {minutes} Min. vorher',
  'library.inHours': 'in {hours} Std.',
  'library.inMinutes': 'in {minutes} Min.',
  'library.cancelReminder': 'Erinnerung für {title} abbrechen',

  /* App shell */
  'app.startingUp': 'Wird gestartet…',

  /* Title bar */
  'titlebar.searchKey': 'Strg K',
  'titlebar.minimize': 'Minimieren',
  'titlebar.maximize': 'Maximieren',
  'titlebar.restore': 'Wiederherstellen',

  /* Audio and subtitle menu */
  'tracks.file': 'Datei',
  'tracks.noSubtitleTracks': 'Dieser Titel hat keine Untertitelspuren.',
  'tracks.openFile': 'Untertiteldatei öffnen…',
  'tracks.timing': 'Zeitversatz',

  /* Stream statistics */
  'stats.resolution': 'Auflösung',
  'stats.frameRate': 'Bildrate',
  'stats.dropped': 'Verloren',
  'stats.codec': 'Codec',
  'stats.pipeline': 'Verarbeitung',
  'stats.declaredFps': '{fps} angegeben',

  /* Command palette */
  'palette.needsSource': 'Füge eine Quelle hinzu, um deine Sender zu durchsuchen…',
  'palette.placeholder': 'Sender, Filme, Serien suchen — oder zu einem Bildschirm springen',
  'palette.goTo': 'Gehe zu',
  'palette.live': 'Live',
  'palette.movie': 'Film',
  'palette.typeMore': 'Tippe mindestens zwei Zeichen.',
  'palette.noResults':
    'Nichts gefunden. Versuche eine kürzere Suche, oder synchronisiere zuerst die Quelle.',
  'palette.toMove': 'bewegen',
  'palette.toOpen': 'öffnen',
  'palette.matchesTotal': '{count} Treffer insgesamt',

  /* Backup and restore */
  'backup.includePasswords': 'Anbieter-Passwörter einschließen',
  'backup.includePasswordsBody':
    'Standardmäßig aus. Eingeschaltet verlangt es eine Passphrase, und die gesamte Sicherung wird damit verschlüsselt.',
  'backup.create': 'Sicherung erstellen',
  'backup.createBody':
    'Quellen, Favoriten, Verlauf und Abspielpositionen sowie deine Einstellungen.',
  'backup.passphraseRequired': 'Passphrase (erforderlich)',
  'backup.passphraseOptional': 'Passphrase (optional)',
  'backup.export': 'Exportieren…',
  'backup.savedOne':
    '{playlists} Quelle, {favorites} Favoriten und {progress} Abspielpositionen in {path} gesichert',
  'backup.savedMany':
    '{playlists} Quellen, {favorites} Favoriten und {progress} Abspielpositionen in {path} gesichert',
  'backup.savedOneEncrypted':
    '{playlists} Quelle, {favorites} Favoriten und {progress} Abspielpositionen verschlüsselt in {path} gesichert',
  'backup.savedManyEncrypted':
    '{playlists} Quellen, {favorites} Favoriten und {progress} Abspielpositionen verschlüsselt in {path} gesichert',
  'backup.restore': 'Wiederherstellen',
  'backup.restoreBody':
    'Zusammenführen behält, was du schon hast. Ersetzen leert vorher alles. Favoriten und Positionen hängen sich wieder an, sobald die Quellen synchronisiert sind.',
  'backup.merge': 'Zusammenführen',
  'backup.replace': 'Ersetzen',
  'backup.replaceConfirm':
    'Ersetzen entfernt zuerst jede Quelle, jeden Favoriten und jede Abspielposition. Fortfahren?',
  'backup.passphrase': 'Passphrase',
  'backup.open': 'Öffnen…',
  'backup.restoredOne':
    '{playlists} Quelle, {favorites} Favoriten, {progress} Abspielpositionen wiederhergestellt.',
  'backup.restoredMany':
    '{playlists} Quellen, {favorites} Favoriten, {progress} Abspielpositionen wiederhergestellt.',
  'backup.reenterPassword': 'Passwort erneut eingeben für:',
  'backup.syncToReattach':
    'Synchronisiere jede Quelle, damit sich anhängt, was noch nicht gepasst hat.',

  /* Account panel */
  'account.body':
    'Wie viele Streams dieses Konto gleichzeitig offen haben darf und wann es abläuft. Die Abfrage geht an deinen Anbieter und läuft deshalb nicht automatisch.',
  'account.connectionsValue': '{active} von {max}',
  'account.notStated': 'Nicht angegeben',
  'account.expired':
    'Dieses Abo ist abgelaufen. Jeder Sender wird scheitern, bis es verlängert wird — das sieht nach einer kaputten App aus statt nach einem abgelaufenen Konto.',
  'account.expiresInOne': 'Läuft in {days} Tag ab.',
  'account.expiresInMany': 'Läuft in {days} Tagen ab.',
  'account.trial': 'Das ist ein Testkonto.',
  'account.singleStream':
    'Dieses Konto erlaubt nur einen Stream gleichzeitig. Alles andere, was es nutzt — ein anderes Gerät, ein Download, eine Aufnahme — stoppt hier die Wiedergabe.',
  'account.matchLimit': 'App an dieses Limit anpassen',
  'account.matchLimitBody':
    'Setzt anhand der eben gemeldeten Zahl, wie viele Downloads gleichzeitig laufen und ob Live-Sender ohne vorherige Erkennung gespielt werden.',
  'account.appliedSingle':
    'Eingestellt auf so wenige Verbindungen wie möglich und einen Download gleichzeitig.',
  'account.appliedOne': 'Eingestellt auf {count} Download gleichzeitig, einer bleibt zum Abspielen.',
  'account.appliedMany':
    'Eingestellt auf {count} Downloads gleichzeitig, einer bleibt zum Abspielen.',
  'account.singleConnectionNote':
    'Die App ist derzeit auf so wenige Verbindungen wie möglich eingestellt.',

  /* Multi-view channel picker */
  'mv.chooseChannel': 'Sender wählen',
  'mv.chooseChannelBody': 'Zuletzt gesehene Sender stehen oben.',
  'mv.noMatches': 'Kein Sender passt zu dieser Suche.',

  /* Player */
  'player.needsFfmpeg':
    'Die Wiedergabe braucht ffmpeg, und es wurde keine funktionierende Kopie gefunden. Die meisten Anbietersender sind MPEG-TS, das die Browser-Engine allein nicht dekodieren kann.',
  'player.openSettings': 'Einstellungen öffnen',
  'player.selectChannel': 'Wähle einen Sender, um zu sehen',
  'player.connecting': 'Verbindung wird aufgebaut…',
  'player.reconnecting': 'Neuverbindung (Versuch {attempt})…',
  'player.streamLine': 'Stream: {pipeline}',
  'player.audioNote': 'Ein Tonwechsel verbindet den Sender neu.',
  'player.subtitlesNote': 'Ein Untertitelwechsel verbindet den Sender neu.'
}
