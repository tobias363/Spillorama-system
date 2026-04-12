#if UNITY_EDITOR
using UnityEngine;
using UnityEditor;

/// <summary>
/// ShellSimulator — Editor-verktøy for å teste Unity-gameplay uten web-shell.
///
/// Åpnes via: Unity-menyen → Spillorama → Shell Simulator
///
/// Simulerer hva index.html normalt sender til Unity via JS-broen:
///   - JWT-token (fra backend/sessions eller manuelt kopiert)
///   - Hall-ID og hallnavn
///   - Spillnavigasjon (Launch Game 1–5)
///   - Hallbytte
///
/// Forutsetter at backend kjører på http://localhost:4000
/// og at du har en gyldig JWT (logg inn via /web/ og kopier fra sessionStorage).
/// </summary>
public class ShellSimulator : EditorWindow
{
    // ── State ────────────────────────────────────────────────────────────────
    private string _jwt = "";
    private string _hallId = "default-hall";
    private string _hallName = "Test-hall";
    private string _gameNumber = "1";
    private string _switchHallId = "";
    private Vector2 _scroll;
    private string _lastAction = "";

    // ── Menu ─────────────────────────────────────────────────────────────────
    [MenuItem("Spillorama/Shell Simulator")]
    public static void Open()
    {
        var window = GetWindow<ShellSimulator>("Shell Simulator");
        window.minSize = new Vector2(380, 520);
        window.Show();
    }

    // ── GUI ──────────────────────────────────────────────────────────────────
    private void OnGUI()
    {
        _scroll = EditorGUILayout.BeginScrollView(_scroll);

        EditorGUILayout.Space(6);
        Header("Shell Simulator", "Tester Unity-gameplay uten web-shell.\nBackend må kjøre på http://localhost:4000");

        // ── Section: Auth ────────────────────────────────────────────────────
        Section("1. Autentisering");
        EditorGUILayout.HelpBox(
            "Kopier JWT fra nettleserkonsollen:\n" +
            "sessionStorage.getItem('spillorama.accessToken')",
            MessageType.Info);

        EditorGUILayout.LabelField("JWT-token");
        _jwt = EditorGUILayout.TextArea(_jwt, GUILayout.Height(52));

        EditorGUILayout.Space(4);
        EditorGUILayout.LabelField("Hall-ID");
        _hallId = EditorGUILayout.TextField(_hallId);
        EditorGUILayout.LabelField("Hallnavn");
        _hallName = EditorGUILayout.TextField(_hallName);

        EditorGUILayout.Space(6);
        using (new EditorGUI.DisabledScope(!Application.isPlaying))
        {
            if (GUILayout.Button("▶  Send token + hall til Unity", GUILayout.Height(34)))
                SimulateLogin();
        }
        NotPlayingWarning();

        // ── Section: Spillnavigasjon ─────────────────────────────────────────
        Section("2. Spillnavigasjon");
        EditorGUILayout.LabelField("Spillnummer (1–5, eller 0 = lobby)");
        _gameNumber = EditorGUILayout.TextField(_gameNumber);

        EditorGUILayout.Space(4);
        using (new EditorGUI.DisabledScope(!Application.isPlaying))
        {
            if (GUILayout.Button($"▶  Launch Game {_gameNumber}", GUILayout.Height(30)))
                SimulateNavigateToGame(_gameNumber);

            EditorGUILayout.Space(4);
            EditorGUILayout.LabelField("Hurtignavigering:");
            EditorGUILayout.BeginHorizontal();
            for (int i = 1; i <= 5; i++)
            {
                if (GUILayout.Button($"Spill {i}"))
                    SimulateNavigateToGame(i.ToString());
            }
            if (GUILayout.Button("Lobby"))
                SimulateNavigateToGame("0");
            EditorGUILayout.EndHorizontal();
        }
        NotPlayingWarning();

        // ── Section: Hallbytte ───────────────────────────────────────────────
        Section("3. Hallbytte (SwitchActiveHallFromHost)");
        EditorGUILayout.LabelField("Ny hall-ID");
        _switchHallId = EditorGUILayout.TextField(_switchHallId);

        using (new EditorGUI.DisabledScope(!Application.isPlaying))
        {
            if (GUILayout.Button("▶  Bytt hall", GUILayout.Height(30)))
                SimulateSwitchHall();
        }
        NotPlayingWarning();

        // ── Section: Returnér til lobby ──────────────────────────────────────
        Section("4. Returnér til lobby");
        using (new EditorGUI.DisabledScope(!Application.isPlaying))
        {
            if (GUILayout.Button("▶  ReturnToLobby", GUILayout.Height(30)))
                SimulateReturnToLobby();
        }
        NotPlayingWarning();

        // ── Status ───────────────────────────────────────────────────────────
        if (!string.IsNullOrEmpty(_lastAction))
        {
            EditorGUILayout.Space(8);
            EditorGUILayout.HelpBox(_lastAction, MessageType.None);
        }

        EditorGUILayout.Space(8);
        EditorGUILayout.EndScrollView();
    }

    // ── Simuleringsmetoder ───────────────────────────────────────────────────

    private void SimulateLogin()
    {
        var ui = FindUIManager();
        if (ui == null) return;

        if (string.IsNullOrEmpty(_jwt))
        {
            _lastAction = "⚠ JWT er tomt. Lim inn token fra sessionStorage.";
            return;
        }

        // Simuler at shellen sender token
        ui.ReceiveShellToken(_jwt.Trim());

        // Simuler at shellen setter aktiv hall
        if (!string.IsNullOrEmpty(_hallId))
            ui.SwitchActiveHallFromHost(_hallId.Trim());

        _lastAction = $"✓ ReceiveShellToken + SwitchActiveHallFromHost('{_hallId}') sendt";
        Debug.Log($"[ShellSimulator] Login simulert — hall: {_hallId}");
    }

    private void SimulateNavigateToGame(string gameNum)
    {
        var ui = FindUIManager();
        if (ui == null) return;

        ui.NavigateToGame(gameNum);
        _lastAction = $"✓ NavigateToGame('{gameNum}') sendt";
        Debug.Log($"[ShellSimulator] NavigateToGame({gameNum})");
    }

    private void SimulateSwitchHall()
    {
        var ui = FindUIManager();
        if (ui == null) return;

        if (string.IsNullOrEmpty(_switchHallId))
        {
            _lastAction = "⚠ Hall-ID er tomt.";
            return;
        }

        ui.SwitchActiveHallFromHost(_switchHallId.Trim());
        _lastAction = $"✓ SwitchActiveHallFromHost('{_switchHallId}') sendt";
        Debug.Log($"[ShellSimulator] SwitchActiveHallFromHost({_switchHallId})");
    }

    private void SimulateReturnToLobby()
    {
        var ui = FindUIManager();
        if (ui == null) return;

        ui.ReturnToLobby();
        _lastAction = "✓ ReturnToLobby() sendt";
        Debug.Log("[ShellSimulator] ReturnToLobby()");
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    private UIManager FindUIManager()
    {
#if UNITY_2023_1_OR_NEWER
        var ui = Object.FindFirstObjectByType<UIManager>();
#else
        var ui = Object.FindObjectOfType<UIManager>();
#endif
        if (ui == null)
        {
            _lastAction = "⚠ UIManager ikke funnet i scenen. Er Game.unity åpen og spiller du?";
            Debug.LogWarning("[ShellSimulator] UIManager ikke funnet.");
        }
        return ui;
    }

    private static void Header(string title, string subtitle)
    {
        var titleStyle = new GUIStyle(EditorStyles.boldLabel) { fontSize = 14 };
        EditorGUILayout.LabelField(title, titleStyle);
        EditorGUILayout.LabelField(subtitle, EditorStyles.wordWrappedMiniLabel);
        EditorGUILayout.Space(4);
        var rect = EditorGUILayout.GetControlRect(false, 1);
        EditorGUI.DrawRect(rect, new Color(0.4f, 0.4f, 0.4f, 0.4f));
        EditorGUILayout.Space(4);
    }

    private static void Section(string label)
    {
        EditorGUILayout.Space(10);
        EditorGUILayout.LabelField(label, EditorStyles.boldLabel);
    }

    private static void NotPlayingWarning()
    {
        if (!Application.isPlaying)
            EditorGUILayout.HelpBox("Trykk Play for å bruke denne funksjonen.", MessageType.Warning);
    }
}
#endif
