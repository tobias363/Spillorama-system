using UnityEditor;
using UnityEngine;

[CustomEditor(typeof(BingoNumberBalls))]
public class BallDisplayEditor : Editor
{
    private  string[] keys = {"b", "i", "n", "g", "o"};
    private BingoNumberBalls t;

    public override void OnInspectorGUI()
    {
        base.OnInspectorGUI();
        t = target as BingoNumberBalls;
        
        if (GUILayout.Button("Generate a ball"))
            GenerateBall();
    }

    private void GenerateBall()
    {
        int n = Random.Range(1, 100);
        t.GenerateBall(keys[n % 5], n);
    }
}
