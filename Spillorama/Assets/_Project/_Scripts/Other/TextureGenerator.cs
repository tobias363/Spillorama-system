using System;
using UnityEngine;

public class TextureGenerator
{
    private Texture2D t;

/// <summary>
/// Returns a pattern texture from the pattern string from database.
/// </summary>
/// <param name="data"></param>
/// <param name="color"></param>
/// <returns></returns>
    public Texture2D GetTextureFromString(string data, PatternColor color)
    {
        int row = data.Split('.').Length;
        int cols = data.Split('.')[0].Split(',').Length;
        string[,] dataArray = new string[row, cols];

        string[] sa = data.Split('.');
        for (int i = 0; i < sa.Length; i++)
        {
            string[] a = sa[i].Split(',');
            for (int j = 0; j < a.Length; j++)
            {
                dataArray[i,j] = a[j];
            }
        }
        return GetTexture(dataArray, color);
    }

    private Texture2D GetTexture(string[,] data, PatternColor color)
    {
        const string v0 = "0";
        const string v1 = "1";

        t = new Texture2D(data.GetLength(0), data.GetLength(1))
        {
            filterMode = FilterMode.Point
        };
        for (int i = 0, ci = 0; i < data.GetLength(0); i++)
        {
            int length = data.GetLength(1);
            for (int j = 0; j < length; j++, ci++)
            {
                string s = data[i, j];
                Color col;
                switch (s)
                {
                    case v0:
                        col = color.color0;
                        break;
                    
                    case v1:
                        col = color.color1;
                        break;
                    
                    default:
                        col = color.neutral;
                        break;
                }
                t.SetPixel(j, length - i - 1, col);
            }
        }
        t.Apply();
        return t;
    }

/// <summary>
/// Returns sprite from pattern string from database.
/// </summary>
/// <param name="s"></param>
/// <param name="color"></param>
/// <returns type="Sprite"></returns>
    public Sprite GetSpriteFromString(string s, PatternColor color)
    {
        t = GetTextureFromString(s, color);
        Rect r = new Rect(0, 0, t.width, t.height);
        Vector2 pivot = Vector2.one * 0.5f;
        return Sprite.Create(t, r, pivot);
    }
}

[Serializable]
public class PatternColor
{
    public Color color0;
    public Color color1;
    public Color neutral;
}