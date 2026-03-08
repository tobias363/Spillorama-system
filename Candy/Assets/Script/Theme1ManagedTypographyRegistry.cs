using System.Collections.Generic;
using TMPro;

public static class Theme1ManagedTypographyRegistry
{
    private static readonly HashSet<int> ManagedTextIds = new HashSet<int>();

    public static void Register(TMP_Text target)
    {
        if (target == null)
        {
            return;
        }

        ManagedTextIds.Add(target.GetInstanceID());
    }

    public static void Unregister(TMP_Text target)
    {
        if (target == null)
        {
            return;
        }

        ManagedTextIds.Remove(target.GetInstanceID());
    }

    public static void Clear()
    {
        ManagedTextIds.Clear();
    }

    public static bool Contains(TMP_Text target)
    {
        return target != null && ManagedTextIds.Contains(target.GetInstanceID());
    }

    public static bool BelongsToTheme1Presentation(TMP_Text target)
    {
        return target != null && target.GetComponentInParent<Theme1GameplayViewRoot>(true) != null;
    }
}
