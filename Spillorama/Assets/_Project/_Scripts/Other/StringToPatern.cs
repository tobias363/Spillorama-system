using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public class StringToPatern : MonoBehaviour
{
    
    public string[] str;
    public SpriteRenderer[] sprites;
    public PatternColor colors;

    void Start()
    {
        StartCoroutine(RotatePattern());
    }

    private void Test()
    {
        for (int i = 0; i < str.Length; i++)
        {
            sprites[i].sprite = GetSpriteFromString(str[i]);
        }
    }

    private Sprite GetSpriteFromString(string s)
    {
        TextureGenerator tg = new TextureGenerator();
        return tg.GetSpriteFromString(s, colors);
    }

    private void ShiftStringArray()
    {
        string tmp = str[0];
        for (int i = 0; i < str.Length - 1; i++)
        {
            str[i] = str[i + 1];
        }
        str[str.Length - 1] = tmp;
    }

    private IEnumerator RotatePattern()
    {
        var wait = new WaitForSeconds(0.3f);
        while (true)
        {
            ShiftStringArray();
            Test();
            yield return wait;
        }
    }
}